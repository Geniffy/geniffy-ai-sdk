// geniffy-ai-sdk through the AI SDK's own generateText and streamText, with the AI SDK's mock model and a
// stand-in Geniffy client: what the model is given, when a run is saved (and when not), tool calls saved with it,
// a conversation sent with every request saved once, an account without the briefing, and the tools.
import assert from "node:assert/strict";
import test from "node:test";
import { generateText, stepCountIs, streamText, tool, jsonSchema } from "ai";
import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";
import { geniffyTools, lastUserText, VERSION, withGeniffy } from "../src/index.js";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};
const stop = { unified: "stop", raw: "end_turn" };
const CONTEXT = "- Asha prefers WhatsApp to email.  [Call with Asha, 1 Oct 2026]";
const BRIEFING = "Where things stand (lumen), as of 2 Oct:\n- Next: send Asha the pricing\n" +
  "What is known (facts):\n- [2026-10-01] Asha prefers WhatsApp to email.";

class Status extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// A Geniffy client that writes down what it was asked. state.briefing is what the briefing says, or the error it
// throws.
function standIn(briefing = BRIEFING) {
  const calls = { briefing: [], context: [], add: [], spaces: [] };
  const state = { briefing };
  const mem = {
    briefing: async (opts) => {
      calls.briefing.push(opts);
      if (state.briefing instanceof Error) throw state.briefing;
      return state.briefing;
    },
    context: async (q) => { calls.context.push(q); return CONTEXT; },
    memories: { add: async (input) => { calls.add.push(input); return { id: "src_1" }; } },
  };
  return { calls, state, client: { space: (s) => { calls.spaces.push(s); return mem; }, ...mem } };
}

const generated = (text, finishReason = stop, content) => ({
  content: content ?? [{ type: "text", text }], finishReason, usage, warnings: [],
});

const weather = tool({ inputSchema: jsonSchema({ type: "object", properties: { city: { type: "string" } } }),
                       execute: async () => "sunny" });

test("a space is required: an app's users never land in its owner's memory by accident", () => {
  assert.throws(() => withGeniffy(new MockLanguageModelV4(), {}), /needs a space/);
  assert.throws(() => geniffyTools(), /needs a space/);
});

test("a blank or undefined space throws: a user with no id never lands in your own memory", () => {
  const { client, calls } = standIn();
  for (const blank of ["", "   "]) {
    assert.throws(() => withGeniffy(new MockLanguageModelV4(), { space: blank, client }), { name: "TypeError", message: /blank/ });
    assert.throws(() => geniffyTools({ space: blank, client }), { name: "TypeError", message: /blank/ });
  }
  const user = {};
  assert.throws(() => withGeniffy(new MockLanguageModelV4(), { space: user.id, client }), { name: "TypeError", message: /undefined/ });
  assert.throws(() => geniffyTools({ space: true, client }), { name: "TypeError", message: /a boolean/ });
  assert.deepEqual(calls.spaces, [], "no space was opened");

  withGeniffy(new MockLanguageModelV4(), { space: 1042, client });
  assert.deepEqual(calls.spaces, ["1042"], "an integer id is the same user as its digits");
});

test("generateText: the model is given the briefing, after the app's own instructions, and the run is saved", async () => {
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
  assert.ok(prompt[1].content.includes(`<memory>\n${BRIEFING}\n</memory>`));
  assert.match(prompt[1].content, /each line with its date/);
  assert.deepEqual(calls.spaces, ["user_42"]);
  assert.deepEqual(calls.briefing, [{ project: undefined, cue: "How should I send Asha the pricing?", budgetChars: 6000 }]);
  assert.deepEqual(calls.context, [], "the briefing holds what is known that bears on the question");
  assert.equal(calls.add.length, 1);
  const { session, ...saved } = calls.add[0];
  assert.match(session, /^run-/, "with no session, a run is a memory of its own");
  assert.deepEqual(saved, { title: "How should I send Asha the pricing?", messages: [
    { role: "user", content: "How should I send Asha the pricing?" },
    { role: "assistant", content: "Sending it on WhatsApp." },
  ] });
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
  const result = streamText({ model: withGeniffy(model, { space: "user_42", client, session: "chat-7" }),
                              prompt: "How should I send Asha the pricing?" });
  let text = "";
  for await (const delta of result.textStream) text += delta;
  assert.equal(text, "Sending it on WhatsApp.");
  assert.match(model.doStreamCalls[0].prompt[0].content, /<memory>/);
  assert.equal(calls.add[0].session, "chat-7");
  assert.deepEqual(calls.add[0].messages.at(-1), { role: "assistant", content: "Sending it on WhatsApp." });
});

test("a tool loop reads the briefing once, and saves the whole run with its tool calls", async () => {
  const { calls, client } = standIn();
  const model = new MockLanguageModelV4({
    doGenerate: [
      generated("", { unified: "tool-calls", raw: "tool_use" },
                [{ type: "tool-call", toolCallId: "c1", toolName: "weather", input: JSON.stringify({ city: "Pune" }) }]),
      generated("It's sunny in Pune, so the outdoor demo is on."),
    ],
  });
  const result = await generateText({
    model: withGeniffy(model, { space: "user_42", client, session: "chat-9" }),
    prompt: "Is the outdoor demo on?",
    tools: { weather },
    stopWhen: stepCountIs(3),
  });
  assert.equal(result.text, "It's sunny in Pune, so the outdoor demo is on.");
  assert.equal(model.doGenerateCalls.length, 2);
  assert.equal(calls.briefing.length, 1, "one question, one lookup, however many steps");
  assert.equal(calls.add.length, 1, "a step that only called tools is not saved on its own");
  assert.deepEqual(calls.add[0].messages, [
    { role: "user", content: "Is the outdoor demo on?" },
    { role: "assistant", content: "", tool_calls: [{ name: "weather", args: { city: "Pune" }, id: "c1" }] },
    { role: "tool", content: "sunny", name: "weather", tool_call_id: "c1" },
    { role: "assistant", content: "It's sunny in Pune, so the outdoor demo is on." },
  ], "what the model did is how Geniffy learns what happened");
});

test("a conversation sent with every request is saved a turn at a time, into its session, labelled by project", async () => {
  const { calls, client } = standIn();
  const model = new MockLanguageModelV4({ doGenerate: generated("Monday works.") });
  await generateText({
    model: withGeniffy(model, { space: "user_42", client, session: "chat-7", project: "lumen" }),
    messages: [
      { role: "user", content: "How should I send Asha the pricing?" },
      { role: "assistant", content: "On WhatsApp." },
      { role: "user", content: "And when?" },
    ],
  });
  assert.deepEqual(calls.briefing.map((b) => b.project), ["lumen"]);
  assert.deepEqual(calls.add, [{ session: "chat-7", title: "And when?", labels: { project: "lumen" }, messages: [
    { role: "user", content: "And when?" }, { role: "assistant", content: "Monday works." },
  ] }], "the earlier turns were saved when they happened");
});

test("without the briefing switched on, what is known is read instead, and the briefing is tried again later", async () => {
  const { calls, client, state } = standIn(new Status(404, "The briefing isn't switched on for this memory yet."));
  const errors = [];
  const ask = (prompt) => generateText({
    model: withGeniffy(new MockLanguageModelV4({ doGenerate: generated("Ok.") }),
                       { space: "user_42", client, onError: (e) => errors.push(e) }),
    prompt,
  });
  await ask("Who signs the Lumen renewal?");
  await ask("Where do I live?");
  assert.equal(calls.briefing.length, 1, "asked once, then not for ten minutes, by any wrapped model");
  assert.deepEqual(calls.context, ["Who signs the Lumen renewal?", "Where do I live?"]);
  assert.deepEqual(errors, [], "not an error");

  state.briefing = BRIEFING;
  const now = Date.now;
  Date.now = () => now() + 601_000;                     // ten minutes on, and it is switched on
  try {
    await ask("And when is it due?");
  } finally {
    Date.now = now;
  }
  assert.equal(calls.briefing.length, 2);
  await ask("Thanks.");
  assert.equal(calls.briefing.length, 3, "and once it answers, it is read every time again");
});

test("a briefing that fails another way is an error, not a reason to read something else", async () => {
  const { calls, client } = standIn(new Status(502, "Your memory didn't answer."));
  const errors = [];
  const model = new MockLanguageModelV4({ doGenerate: generated("Hello.") });
  await generateText({ model: withGeniffy(model, { space: "u", client, onError: (e) => errors.push(e.status) }),
                       prompt: "Hello there" });
  assert.deepEqual(errors, [502]);
  assert.deepEqual(calls.context, []);
  assert.deepEqual(model.doGenerateCalls[0].prompt.map((m) => m.role), ["user"]);
});

test("an empty briefing still says nothing is remembered yet; briefing: false reads only the question", async () => {
  const empty = standIn("");
  const model = new MockLanguageModelV4({ doGenerate: () => generated("Ok.") });
  await generateText({ model: withGeniffy(model, { space: "u", client: empty.client }), prompt: "What is my name?" });
  assert.ok(model.doGenerateCalls[0].prompt[0].content.includes("<memory>\nNothing is remembered about this user yet.\n</memory>"));

  const { calls, client } = standIn();
  await generateText({ model: withGeniffy(model, { space: "u", client, briefing: false }), prompt: "Who signs it?" });
  assert.deepEqual(calls.briefing, []);
  assert.deepEqual(calls.context, ["Who signs it?"]);
  assert.ok(model.doGenerateCalls[1].prompt[0].content.includes(CONTEXT));
});

test("remember: false only reads; a memory that is away never breaks the reply", async () => {
  const { calls, client } = standIn();
  await generateText({ model: withGeniffy(new MockLanguageModelV4({ doGenerate: generated("Hi.") }), { space: "u", client, remember: false }),
                       prompt: "Hello there, how are you?" });
  assert.equal(calls.add.length, 0);

  const errors = [];
  const fail = async () => { throw new Error("Geniffy is away"); };
  const away = { space: () => ({ briefing: fail, context: fail, memories: { add: fail } }) };
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
  assert.equal(calls.briefing.length, 301, "the newest question is still held; the oldest was let go and asked again");
});

test("the client it makes names this package, at the version package.json says", async () => {
  const { readFile } = await import("node:fs/promises");
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf-8"));
  assert.equal(VERSION, pkg.version);
});
