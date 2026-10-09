// Geniffy for the Vercel AI SDK: a memory of each of your users, for any model the AI SDK supports.
//
//   withGeniffy(model, { space })   the model, wrapped: the user's briefing goes in front of every call, and each
//                                   finished run is saved, tool calls included, into one memory for the conversation
//   geniffyMiddleware({ space })    the same, as a middleware for wrapLanguageModel
//   geniffyTools({ space })         recall and remember, as tools the model calls itself
//
// Nothing here talks to a model: it uses the AI SDK's own middleware and tools, so streaming, tools and
// every provider work as they did. The memory calls go through the geniffy SDK.
import { jsonSchema, tool, wrapLanguageModel } from "ai";
import { Geniffy } from "geniffy";

// This package's own name and version, sent after the SDK's so the Requests page in the Geniffy app shows which
// integration made each call. Kept equal to package.json by a test.
export const VERSION = "0.2.0";

const DEFAULT_INSTRUCTIONS =
  "What follows is this user's memory: what this app knows from before, each line with its date. " +
  "Use it when it helps and don't recite it. If it doesn't cover something, say so instead of guessing.";

// A briefing with nothing in it yet still says so: a model reads an empty memory as permission to invent.
const NOTHING_YET = "Nothing is remembered about this user yet.";

const NO_SPACE =
  "Geniffy needs a space: the user this is for, such as { space: `user_${user.id}` }. " +
  "Pass { space: null } only for your own memory, never for your users' data.";

const PER_CALL = 500;         // the most messages Geniffy takes in one call
const OFF_MS = 600_000;       // how long only what bears on the question is read after the briefing was found off
// What Geniffy keeps of a message, so nothing larger is sent: a turn's words, a tool call's input and a tool's output.
const TURN_CHARS = 50_000;
const CALL_CHARS = 2_000;
const RESULT_CHARS = 4_000;

// When the briefing was last found not switched on for this key (404), or the API was from before it (405). Kept
// for the whole app, since a model is usually wrapped once per request.
let briefingOffUntil = 0;

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
  const client = options.client ??
    new Geniffy({ ...(options.apiKey ? { apiKey: options.apiKey } : {}), integration: `geniffy-ai-sdk/${VERSION}` });
  return space === null ? client : client.space(space);
}

const textOf = (content) =>
  typeof content === "string" ? content
    : Array.isArray(content) ? content.filter((p) => p && p.type === "text").map((p) => p.text).join("\n") : "";

const clip = (text, most) => String(text ?? "").trim().slice(0, most);

// The last thing the user said, in a prompt as the AI SDK hands it to a model.
export function lastUserText(prompt) {
  for (let i = (prompt || []).length - 1; i >= 0; i--) {
    if (prompt[i].role === "user") return textOf(prompt[i].content).trim();
  }
  return "";
}

// Where the run being answered starts: just after the last answer before the user's last message, so the history
// an app sends with every request is not saved again, and two messages sent at once are both in it.
function turnStart(prompt) {
  let user = -1;
  for (let i = prompt.length - 1; i >= 0; i--) if (prompt[i].role === "user") { user = i; break; }
  for (let i = user - 1; i >= 0; i--) if (prompt[i].role === "assistant") return i + 1;
  return 0;
}

function call(name, input, id) {
  let shown;
  try {
    shown = typeof input === "string" ? input : JSON.stringify(input ?? {});
  } catch {
    shown = String(input);
  }
  const out = { name: String(name || "tool").slice(0, 200),
                args: shown.length <= CALL_CHARS ? (input ?? {}) : shown.slice(0, CALL_CHARS) };
  if (id) out.id = String(id).slice(0, 200);
  return out;
}

// A tool's output, whichever shape the AI SDK holds it in: text, JSON, content parts, or a call that was denied.
function outputText(output) {
  if (output == null) return "";
  if (typeof output === "string") return output;
  switch (output.type) {
    case "text": case "error-text": return String(output.value ?? "");
    case "json": case "error-json": return JSON.stringify(output.value ?? null);
    case "content": return textOf(output.value);
    case "execution-denied": return `Denied${output.reason ? `: ${output.reason}` : ""}`;
    default: return JSON.stringify(output);
  }
}

// A prompt message as Geniffy reads a conversation: what the user said, what the model answered with the tools it
// called, and what each tool returned. System messages are the app's instructions, and are left out.
function sentOf(message) {
  const { role, content } = message;
  if (role === "user") return [{ role: "user", content: clip(textOf(content), TURN_CHARS) }];
  if (role === "assistant") {
    const parts = Array.isArray(content) ? content : [{ type: "text", text: String(content ?? "") }];
    const out = { role: "assistant", content: clip(textOf(parts), TURN_CHARS) };
    const calls = parts.filter((p) => p && p.type === "tool-call").slice(0, 100)
      .map((p) => call(p.toolName, p.input ?? p.args, p.toolCallId));
    if (calls.length) out.tool_calls = calls;
    return [out];
  }
  if (role === "tool") {
    return (Array.isArray(content) ? content : []).filter((p) => p && p.type === "tool-result").map((p) => {
      const out = { role: "tool", content: clip(outputText(p.output ?? p.result), RESULT_CHARS) };
      if (p.toolName) out.name = String(p.toolName).slice(0, 200);
      if (p.toolCallId) out.tool_call_id = String(p.toolCallId).slice(0, 200);
      return out;
    });
  }
  return [];
}

function titleOf(sent) {
  const first = sent.find((m) => m.role === "user" && m.content.trim());
  if (!first) return undefined;
  const words = first.content.split(/\s+/).join(" ").trim();
  return words.length <= 80 ? words : `${words.slice(0, 80).replace(/\s+\S*$/, "")}...`;
}

// "stop", whichever shape the AI SDK version uses ({ unified } since AI SDK 6, a string before).
const finishedWith = (reason) => (typeof reason === "string" ? reason : reason?.unified);

export function geniffyMiddleware(options) {
  const mem = memoryFor(options);
  const remember = options.remember !== false;
  const briefing = options.briefing !== false;
  const budgetChars = options.budgetChars ?? 6000;
  const project = options.project ?? undefined;
  const session = options.session ?? undefined;
  const instructions = options.instructions ?? DEFAULT_INSTRUCTIONS;
  const onError = options.onError ?? ((error) => console.warn(`[geniffy] ${error?.message || error}`));
  // A run with tools calls the model once per step, with the same question: ask Geniffy once. Kept for a few
  // seconds and a few hundred questions, so a model wrapped once for a whole app neither grows nor goes stale.
  const contexts = new Map();
  const KEEP_MS = 30_000;
  const MOST = 256;

  const read = async (question) => {
    if (briefing && Date.now() >= briefingOffUntil) {
      try {
        const text = await mem.briefing({ project, cue: question, budgetChars });
        briefingOffUntil = 0;
        return text || NOTHING_YET;
      } catch (error) {
        if (error?.status !== 404 && error?.status !== 405) throw error;
        briefingOffUntil = Date.now() + OFF_MS;   // what bears on the question is read instead, for ten minutes
      }
    }
    return question ? mem.context(question) : null;
  };

  const contextFor = (question) => {
    const held = contexts.get(question);
    if (held && Date.now() - held.at < KEEP_MS) return held.context;
    contexts.delete(question);
    const context = read(question).catch((error) => {
      contexts.delete(question);
      onError(error);
      return null;
    });
    contexts.set(question, { at: Date.now(), context });
    while (contexts.size > MOST) contexts.delete(contexts.keys().next().value);
    return context;
  };

  // Saved once per run, when the model gives its final answer (not on a step that only called tools): what the user
  // said, each tool the model called and what it returned, and the answer, into the conversation's one memory.
  const save = async (prompt, answer) => {
    if (!remember) return;
    const sent = prompt.slice(turnStart(prompt)).flatMap(sentOf);
    if (answer.trim()) sent.push({ role: "assistant", content: clip(answer, TURN_CHARS) });
    const said = sent.filter((m) => m.content || m.tool_calls || m.role === "tool");
    if (!said.some((m) => m.role === "user") || !answer.trim()) return;
    const name = session ?? `run-${runId()}`;
    try {
      for (let i = 0; i < said.length; i += PER_CALL) {
        await mem.memories.add({ messages: said.slice(i, i + PER_CALL), session: name, title: titleOf(said),
                                 ...(project ? { labels: { project } } : {}) });
      }
    } catch (error) {
      onError(error);
    }
  };

  const withMemory = (params, context) => {
    if (!context) return params;
    const prompt = [...params.prompt];
    let at = 0;
    while (at < prompt.length && prompt[at].role === "system") at++; // after the app's own instructions
    const block = `${instructions ? `${instructions}\n\n` : ""}<memory>\n${context}\n</memory>`;
    prompt.splice(at, 0, { role: "system", content: block });
    return { ...params, prompt };
  };

  return {
    specificationVersion: "v4",
    async transformParams({ params }) {
      return withMemory(params, await contextFor(lastUserText(params.prompt)));
    },
    async wrapGenerate({ doGenerate, params }) {
      const result = await doGenerate();
      if (finishedWith(result.finishReason) === "stop") {
        await save(params.prompt || [], (result.content || []).filter((c) => c.type === "text").map((c) => c.text).join(""));
      }
      return result;
    },
    async wrapStream({ doStream, params }) {
      const { stream, ...rest } = await doStream();
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
          if (finish === "stop") await save(params.prompt || [], answer);
        },
      });
      return { stream: stream.pipeThrough(watch), ...rest };
    },
  };
}

// A run's own memory, when no session names the conversation: the platform's random UUID where there is one (Node
// 19 and later, Deno, Bun, edge runtimes), else time and chance.
const runId = () => globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

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
