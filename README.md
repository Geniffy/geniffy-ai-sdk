<p align="center">
  <a href="https://geniffy.com"><img src="https://geniffy.com/brand/geniffy-lockup-ink.png" alt="Geniffy" height="44"></a>
</p>

# Geniffy for the Vercel AI SDK

Give your AI SDK app a memory of each of your users, for any model the AI SDK supports. Wrap the model, and before
every reply it gets the user's briefing: where things stand, what is due, the rules that apply, what happened, and
what is known that bears on their message. After the reply, the run is saved, tool calls included, into one memory
for the whole conversation. When nothing is known, the model is told so, and says so instead of guessing.

[![CI](https://github.com/Geniffy/geniffy-ai-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/Geniffy/geniffy-ai-sdk/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/geniffy-ai-sdk)](https://www.npmjs.com/package/geniffy-ai-sdk)
[![Docs](https://img.shields.io/badge/docs-docs.geniffy.com-1A1814)](https://docs.geniffy.com/integrations/vercel-ai-sdk)

```bash
npm install geniffy-ai-sdk ai
```

Set `GENIFFY_API_KEY` from **API keys** in the [Geniffy app](https://geniffy.com/app). Keep it on your server.

## Wrap the model

```ts
import { anthropic } from "@ai-sdk/anthropic";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { withGeniffy } from "geniffy-ai-sdk";

export async function POST(req: Request) {
  const { id, messages }: { id: string; messages: UIMessage[] } = await req.json();
  const user = await signedInUser(req);               // your own sign-in, never the request body

  const result = streamText({
    model: withGeniffy(anthropic("claude-opus-5-5"), { space: `user_${user.id}`, session: id }),
    messages: await convertToModelMessages(messages),
  });
  return result.toUIMessageStreamResponse();
}
```

- **Before each reply**, the user's briefing goes in a system message after your own instructions: where things
  stand, what is due or was promised, the rules that apply, what happened, then what is known that bears on their
  last message, each line dated. In a run with tools, Geniffy is asked once, not once per step.
- **After the final answer**, the run is saved to that user's space: what they said, each tool the model called and
  what it returned, and the answer. `session` is the conversation (the chat's id), and a conversation is one memory
  however long it gets: the history your app sends with every request is not saved again. Without `session`, each
  run is a memory of its own. The stream closes only once the run is saved, so a serverless function never ends
  halfway through.
- **If Geniffy can't be reached**, the reply goes on without memory, and `onError` hears about it.

Options: `project` keeps the briefing to one project and labels what is saved with it; `briefing: false` reads only
what bears on the user's last message; `budgetChars` is the most the briefing adds (6,000 characters unless you
say); `remember: false` only reads; `instructions` changes what the model is told about the memory; `client` or
`apiKey` brings your own Geniffy client; and `onError`. An account without the briefing switched on is given what
bears on the last message instead, and the briefing is tried again ten minutes later. `geniffyMiddleware(options)` is
the same, for `wrapLanguageModel` alongside other middleware.

## Or give the model tools

```ts
import { generateText, stepCountIs } from "ai";
import { geniffyTools } from "geniffy-ai-sdk";

const result = await generateText({
  model: anthropic("claude-opus-5-5"),
  tools: geniffyTools({ space: `user_${user.id}` }),  // recall and remember
  stopWhen: stepCountIs(5),
  prompt: "What did I say about the Lumen renewal?",
});
```

## One space per user

`space` is required: the user this is for, such as `` `user_${user.id}` ``. Each space is a memory of its own,
and nothing else can read it. Pass `space: null` only for your own memory, never for your users' data. A blank or
undefined space throws, so a user with no id never lands in your own memory. When a user
deletes their account, forget them with `new Geniffy().forgetSpace(...)` from the
[geniffy](https://www.npmjs.com/package/geniffy) SDK.

## Develop

```bash
npm test          # through the AI SDK's own generateText and streamText, with its mock model, and the real
                  # geniffy client against a stand-in for the API
npm run check     # the type declarations against the AI SDK's types
```

## Security

Report a vulnerability to ops@geniffy.com, not in a public issue. See the
[security policy](https://github.com/Geniffy/.github/blob/main/SECURITY.md).
