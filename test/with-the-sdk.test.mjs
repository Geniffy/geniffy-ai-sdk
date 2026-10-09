// geniffy-ai-sdk with the real geniffy client, its calls answered by a stand-in for the API through the client's
// own fetch option: what goes over the wire for the briefing, for a run saved into its conversation, and for an
// account without the briefing switched on.
import assert from "node:assert/strict";
import test from "node:test";
import { generateText, stepCountIs, tool, jsonSchema } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { Geniffy } from "geniffy";
import { VERSION, withGeniffy } from "../src/index.js";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};
const CONTEXT = "- Asha prefers WhatsApp to email.  [Call with Asha, 1 Oct 2026]";
const BRIEFING = "Where things stand (lumen), as of 2 Oct:\n- Next: send Asha the pricing";
const SOURCE = { id: "a".repeat(32), kind: "note", title: "Is the outdoor demo on?", status: "reading" };
const KEY = "gnf_test";   // the stand-in takes any key

// The API, as far as the middleware reaches it: the briefing (or not switched on), context and adding.
function api(briefingOn = true) {
  const calls = [];
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch = async (url, init) => {
    const path = new URL(url).pathname;
    const headers = new Headers(init.headers);
    calls.push([path, headers.get("x-geniffy-space"), JSON.parse(init.body || "{}")]);
    assert.ok(headers.get("x-geniffy-client")?.endsWith(` geniffy-ai-sdk/${VERSION}`), "the Requests page names this package");
    if (path === "/v1/briefing") {
      return briefingOn ? json(200, { briefing: BRIEFING, now: [], due: [], lessons: [], episodes: [], memories: [] })
        : json(404, { error: { code: "not_switched_on", message: "The briefing isn't switched on for this memory yet." } });
    }
    if (path === "/v1/context") return json(200, { context: CONTEXT, memories: [], found: true });
    if (path === "/v1/memories") return json(201, { source: SOURCE });
    return json(404, { error: { code: "not_found", message: "No such door." } });
  };
  return { calls, client: new Geniffy({ apiKey: KEY, baseURL: "https://api.test", fetch, maxRetries: 0,
                                        integration: `geniffy-ai-sdk/${VERSION}` }) };
}

async function run(client, opts = {}) {
  const model = new MockLanguageModelV4({
    doGenerate: [
      { content: [{ type: "tool-call", toolCallId: "c1", toolName: "weather", input: JSON.stringify({ city: "Pune" }) }],
        finishReason: { unified: "tool-calls", raw: "tool_use" }, usage, warnings: [] },
      { content: [{ type: "text", text: "It's sunny, so the demo is on." }], finishReason: { unified: "stop", raw: "end_turn" },
        usage, warnings: [] },
    ],
  });
  await generateText({
    model: withGeniffy(model, { space: "user_42", client, session: "chat-7", project: "lumen", ...opts }),
    prompt: "Is the outdoor demo on?",
    tools: { weather: tool({ inputSchema: jsonSchema({ type: "object", properties: { city: { type: "string" } } }),
                             execute: async () => "sunny" }) },
    stopWhen: stepCountIs(3),
  });
  return model;
}

test("the briefing and the run, as they go over the wire", async () => {
  const { calls, client } = api();
  await run(client);
  assert.deepEqual(calls, [
    ["/v1/briefing", "user_42", { project: "lumen", cue: "Is the outdoor demo on?", budget_chars: 6000 }],
    ["/v1/memories", "user_42", { messages: [
      { role: "user", content: "Is the outdoor demo on?" },
      { role: "assistant", content: "", tool_calls: [{ name: "weather", args: { city: "Pune" }, id: "c1" }] },
      { role: "tool", content: "sunny", name: "weather", tool_call_id: "c1" },
      { role: "assistant", content: "It's sunny, so the demo is on." },
    ], session: "chat-7", title: "Is the outdoor demo on?", labels: { project: "lumen" } }],
  ]);
});

test("an account without the briefing reads context over the wire", async () => {
  const { calls, client } = api(false);
  const model = await run(client);
  assert.deepEqual(calls.map(([path]) => path), ["/v1/briefing", "/v1/context", "/v1/memories"]);
  assert.ok(model.doGenerateCalls[0].prompt[0].content.includes(CONTEXT));
  const now = Date.now;
  Date.now = () => now() + 601_000;   // and ten minutes on, the briefing is tried again, so later tests read it
  try {
    await run(api().client);
  } finally {
    Date.now = now;
  }
});
