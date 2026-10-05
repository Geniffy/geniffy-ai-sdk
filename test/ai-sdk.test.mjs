// geniffy-ai-sdk through the AI SDK's own generateText and streamText, with the AI SDK's mock model and a
// stand-in Geniffy client: what the model is given, when an exchange is saved (and when not), tool loops,
// and the tools.
import assert from "node:assert/strict";
import test from "node:test";
import { generateText, stepCountIs, streamText, tool, jsonSchema } from "ai";
import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";
import { geniffyTools, lastUserText, withGeniffy } from "../src/index.js";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};
const stop = { unified: "stop", raw: "end_turn" };

// A Geniffy client that writes down what it was asked.
function standIn(context = "- Asha prefers WhatsApp to email.  [Call with Asha, 1 Oct 2026]") {
  const calls = { context: [], add: [], spaces: [] };
  const mem = {
    context: async (q) => { calls.context.push(q); return context; },
    memories: { add: async (input) => { calls.add.push(input); return { id: "src_1" }; } },
  };
  return { calls, client: { space: (s) => { calls.spaces.push(s); return mem; }, ...mem } };
}

const generated = (text, finishReason = stop, content) => ({
  content: content ?? [{ type: "text", text }], finishReason, usage, warnings: [],
});

test("a space is required: an app's users never land in its owner's memory by accident", () => {
  assert.throws(() => withGeniffy(new MockLanguageModelV4(), {}), /needs a space/);
  assert.throws(() => geniffyTools(), /needs a space/);
});

test("generateText: the model is given what is known, after the app's own instructions, and the exchange is saved", async () => {
  const { calls, client } = standIn();
  const model = new MockLanguageModelV4({ doGenerate: generated("Sending it on WhatsApp.") });
  const result = await generateText({
    model: withGeniffy(model, { space: "user_42", client }),
    system: "You are a helpful assistant.",
    prompt: "How should I send Asha the pricing?",
  });
  assert.equal(result.text, "Sending it on WhatsApp.");
  const prompt = model.doGenerateCalls[0].prompt;
  assert.deepEqual(prompt.map((m) => m.role), ["system", "system", "user"]);
  assert.equal(prompt[0].content, "You are a helpful assistant.");
  assert.match(prompt[1].content, /<memory>\n- Asha prefers WhatsApp to email\.  \[Call with Asha, 1 Oct 2026\]\n<\/memory>/);
  assert.deepEqual(calls.spaces, ["user_42"]);
  assert.deepEqual(calls.add, [{ messages: [
    { role: "user", content: "How should I send Asha the pricing?" },
    { role: "assistant", content: "Sending it on WhatsApp." },
  ] }]);
});

test("streamText: the reply streams as before, and is saved once the stream is done", async () => {
  const { calls, client } = standIn();
  const model = new MockLanguageModelV4({
    doStream: {
      stream: convertArrayToReadableStream([
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: "Sending it " },
        { type: "text-delta", id: "t1", delta: "on WhatsApp." },
        { type: "text-end", id: "t1" },
        { type: "finish", finishReason: stop, usage },
      ]),
    },
  });
  const result = streamText({ model: withGeniffy(model, { space: "user_42", client }), prompt: "How should I send Asha the pricing?" });
  let text = "";
  for await (const delta of result.textStream) text += delta;
  assert.equal(text, "Sending it on WhatsApp.");
  assert.match(model.doStreamCalls[0].prompt[0].content, /<memory>/);
  assert.deepEqual(calls.add[0].messages.at(-1), { role: "assistant", content: "Sending it on WhatsApp." });
});

test("a tool loop asks Geniffy once, and saves only the final answer", async () => {
  const { calls, client } = standIn();
  const model = new MockLanguageModelV4({
    doGenerate: [
      generated("", { unified: "tool-calls", raw: "tool_use" },
                [{ type: "tool-call", toolCallId: "c1", toolName: "weather", input: JSON.stringify({ city: "Pune" }) }]),
      generated("It's sunny in Pune, so the outdoor demo is on."),
    ],
  });
  const result = await generateText({
    model: withGeniffy(model, { space: "user_42", client }),
    prompt: "Is the outdoor demo on?",
    tools: { weather: tool({ inputSchema: jsonSchema({ type: "object", properties: { city: { type: "string" } } }),
                             execute: async () => "sunny" }) },
    stopWhen: stepCountIs(3),
  });
  assert.equal(result.text, "It's sunny in Pune, so the outdoor demo is on.");
  assert.equal(model.doGenerateCalls.length, 2);
  assert.deepEqual(calls.context, ["Is the outdoor demo on?"], "one question, one lookup, however many steps");
  assert.equal(calls.add.length, 1);
  assert.equal(calls.add[0].messages[1].content, "It's sunny in Pune, so the outdoor demo is on.");
});

test("remember: false only reads; a memory that is away never breaks the reply", async () => {
  const { calls, client } = standIn();
  await generateText({ model: withGeniffy(new MockLanguageModelV4({ doGenerate: generated("Hi.") }), { space: "u", client, remember: false }),
                       prompt: "Hello there, how are you?" });
  assert.equal(calls.add.length, 0);

  const errors = [];
  const away = { space: () => ({ context: async () => { throw new Error("Geniffy is away"); },
                                  memories: { add: async () => { throw new Error("Geniffy is away"); } } }) };
  const model = new MockLanguageModelV4({ doGenerate: generated("Hello!") });
  const result = await generateText({ model: withGeniffy(model, { space: "u", client: away, onError: (e) => errors.push(e.message) }),
                                      prompt: "Hello there, how are you?" });
  assert.equal(result.text, "Hello!");
  assert.deepEqual(model.doGenerateCalls[0].prompt.map((m) => m.role), ["user"], "nothing added when the memory is away");
  assert.deepEqual(errors, ["Geniffy is away", "Geniffy is away"]);
});

test("the tools look up and save in the user's space", async () => {
  const { calls, client } = standIn();
  const tools = geniffyTools({ space: "user_42", client });
  assert.match(await tools.recall.execute({ query: "Asha" }, { toolCallId: "1", messages: [] }), /WhatsApp/);
  assert.equal(await tools.remember.execute({ text: "I prefer mornings." }, { toolCallId: "2", messages: [] }), "Saved.");
  assert.deepEqual(calls.add, [{ text: "I prefer mornings." }]);
  assert.deepEqual(calls.spaces, ["user_42"]);
});

test("the question is the last thing the user said, as the AI SDK hands it over", () => {
  assert.equal(lastUserText([{ role: "system", content: "x" },
                             { role: "user", content: [{ type: "text", text: "First" }] },
                             { role: "assistant", content: [{ type: "text", text: "Ok" }] },
                             { role: "user", content: [{ type: "text", text: "Second" }, { type: "file", data: "", mediaType: "image/png" }] }]),
               "Second");
  assert.equal(lastUserText([]), "");
});

test("a model wrapped once for a whole app keeps only recent lookups", async () => {
  const { calls, client } = standIn();
  const model = new MockLanguageModelV4({ doGenerate: () => generated("Ok.") });
  const wrapped = withGeniffy(model, { space: "u", client, remember: false });
  for (let i = 0; i < 300; i++) await generateText({ model: wrapped, prompt: `Question number ${i}?` });
  await generateText({ model: wrapped, prompt: "Question number 299?" });
  await generateText({ model: wrapped, prompt: "Question number 0?" });
  assert.equal(calls.context.length, 301, "the newest question is still held; the oldest was let go and asked again");
});
