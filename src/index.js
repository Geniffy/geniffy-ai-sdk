// Geniffy for the Vercel AI SDK: a memory of each of your users, for any model the AI SDK supports.
//
//   withGeniffy(model, { space })   the model, wrapped: what is known about the user goes in front of every
//                                   call, and each finished exchange is saved
//   geniffyMiddleware({ space })    the same, as a middleware for wrapLanguageModel
//   geniffyTools({ space })         recall and remember, as tools the model calls itself
//
// Nothing here talks to a model: it uses the AI SDK's own middleware and tools, so streaming, tools and
// every provider work as they did. The memory calls go through the geniffy SDK.
import { jsonSchema, tool, wrapLanguageModel } from "ai";
import { Geniffy } from "geniffy";

const DEFAULT_INSTRUCTIONS =
  "What follows is this user's memory: what they told this app before, each line with where it came from. " +
  "Use it when it helps and don't recite it. If it doesn't cover something, say so instead of guessing.";

const NO_SPACE =
  "Geniffy needs a space: the user this is for, such as { space: `user_${user.id}` }. " +
  "Pass { space: null } only for your own memory, never for your users' data.";

// The user a space names: a string, or an integer id. Blank and undefined are refused rather than read as
// your own memory, since each is what a missing user id looks like, and that user would land in it.
function spaceName(space) {
  if (typeof space === "number" && Number.isSafeInteger(space)) return String(space);
  if (typeof space !== "string") {
    throw new TypeError(`Geniffy's space is ${space === undefined ? "undefined" : `a ${typeof space}`}, not ` +
      `the user this is for. ${NO_SPACE}`);
  }
  if (!space.trim()) throw new TypeError(`Geniffy's space is blank: it would be your own memory. ${NO_SPACE}`);
  return space;
}

function memoryFor(options) {
  if (!options || !("space" in options)) throw new TypeError(NO_SPACE);
  const space = options.space === null ? null : spaceName(options.space);
  const client = options.client ?? new Geniffy(options.apiKey ? { apiKey: options.apiKey } : undefined);
  return space === null ? client : client.space(space);
}

const textOf = (content) =>
  typeof content === "string" ? content
    : Array.isArray(content) ? content.filter((p) => p && p.type === "text").map((p) => p.text).join("\n") : "";

// The last thing the user said, in a prompt as the AI SDK hands it to a model.
export function lastUserText(prompt) {
  for (let i = (prompt || []).length - 1; i >= 0; i--) {
    if (prompt[i].role === "user") return textOf(prompt[i].content).trim();
  }
  return "";
}

// "stop", whichever shape the AI SDK version uses ({ unified } since AI SDK 6, a string before).
const finishedWith = (reason) => (typeof reason === "string" ? reason : reason?.unified);

export function geniffyMiddleware(options) {
  const mem = memoryFor(options);
  const remember = options.remember !== false;
  const instructions = options.instructions ?? DEFAULT_INSTRUCTIONS;
  const onError = options.onError ?? ((error) => console.warn(`[geniffy] ${error?.message || error}`));
  // A run with tools calls the model once per step, with the same question: ask Geniffy once. Kept for a few
  // seconds and a few hundred questions, so a model wrapped once for a whole app neither grows nor goes stale.
  const contexts = new Map();
  const KEEP_MS = 30_000;
  const MOST = 256;

  const contextFor = (question) => {
    const held = contexts.get(question);
    if (held && Date.now() - held.at < KEEP_MS) return held.context;
    contexts.delete(question);
    const context = Promise.resolve(mem.context(question)).catch((error) => {
      contexts.delete(question);
      onError(error);
      return null;
    });
    contexts.set(question, { at: Date.now(), context });
    while (contexts.size > MOST) contexts.delete(contexts.keys().next().value);
    return context;
  };

  // Saved once per exchange, when the model gives its final answer (not on a step that only called tools).
  const save = async (question, answer) => {
    if (!remember || !question || !answer.trim()) return;
    try {
      await mem.memories.add({ messages: [{ role: "user", content: question }, { role: "assistant", content: answer }] });
    } catch (error) {
      onError(error);
    }
  };

  return {
    specificationVersion: "v4",
    async transformParams({ params }) {
      const question = lastUserText(params.prompt);
      if (!question) return params;
      const context = await contextFor(question);
      if (!context) return params;
      const prompt = [...params.prompt];
      let at = 0;
      while (at < prompt.length && prompt[at].role === "system") at++; // after the app's own instructions
      prompt.splice(at, 0, { role: "system", content: `${instructions}\n\n<memory>\n${context}\n</memory>` });
      return { ...params, prompt };
    },
    async wrapGenerate({ doGenerate, params }) {
      const result = await doGenerate();
      if (finishedWith(result.finishReason) === "stop") {
        await save(lastUserText(params.prompt), (result.content || []).filter((c) => c.type === "text").map((c) => c.text).join(""));
      }
      return result;
    },
    async wrapStream({ doStream, params }) {
      const { stream, ...rest } = await doStream();
      const question = lastUserText(params.prompt);
      let answer = "";
      let finish;
      const watch = new TransformStream({
        transform(chunk, controller) {
          if (chunk.type === "text-delta") answer += chunk.delta ?? chunk.textDelta ?? "";
          if (chunk.type === "finish") finish = finishedWith(chunk.finishReason);
          controller.enqueue(chunk);
        },
        // The stream closes only after the save, so a serverless function never ends halfway through it.
        async flush() {
          if (finish === "stop") await save(question, answer);
        },
      });
      return { stream: stream.pipeThrough(watch), ...rest };
    },
  };
}

export function withGeniffy(model, options) {
  return wrapLanguageModel({ model, middleware: geniffyMiddleware(options) });
}

export function geniffyTools(options) {
  const mem = memoryFor(options);
  return {
    recall: tool({
      description: "Look up what is known about the user: their preferences, people, plans and what they said " +
        "before, each line with where it came from. When nothing is known, it says so.",
      inputSchema: jsonSchema({
        type: "object",
        properties: { query: { type: "string", description: "What to look up, in words" } },
        required: ["query"],
        additionalProperties: false,
      }),
      execute: async ({ query }) => mem.context(query),
    }),
    remember: tool({
      description: "Save something the user asked you to remember, in their words. Never passwords, keys or other secrets.",
      inputSchema: jsonSchema({
        type: "object",
        properties: { text: { type: "string", description: "What to remember" } },
        required: ["text"],
        additionalProperties: false,
      }),
      execute: async ({ text }) => {
        await mem.memories.add({ text });
        return "Saved.";
      },
    }),
  };
}
