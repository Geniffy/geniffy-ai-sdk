<p align="center">
  <a href="https://geniffy.com"><img src="https://geniffy.com/brand/geniffy-lockup-ink.png" alt="Geniffy" height="44"></a>
</p>

# Geniffy for the Vercel AI SDK

Give your AI SDK app a memory of each of your users, for any model the AI SDK supports. Wrap the model, and it
is told what is known about the user before every reply, each line with where it came from, and each exchange is
saved after. When nothing is known, the model is told so, and says so instead of guessing.

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
  const { messages }: { messages: UIMessage[] } = await req.json();
  const user = await signedInUser(req);               // your own sign-in, never the request body

  const result = streamText({
    model: withGeniffy(anthropic("claude-opus-5-5"), { space: `user_${user.id}` }),
    messages: await convertToModelMessages(messages),
  });
  return result.toUIMessageStreamResponse();
}
```

- **Before each reply**, Geniffy is asked what is known that bears on the user's last message, and the answer goes
  in a system message after your own instructions.
- **After the final answer**, the exchange is saved to that user's space. The stream closes only once it is saved,
  so a serverless function never ends halfway through. A step that only calls tools is not saved.
- **If Geniffy can't be reached**, the reply goes on without memory, and `onError` hears about it.

Options: `remember: false` to only read, `instructions` to change what the model is told about the memory,
`client` or `apiKey` to bring your own Geniffy client, and `onError`. `geniffyMiddleware(options)` is the same,
for `wrapLanguageModel` alongside other middleware.

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
and nothing else can read it. Pass `space: null` only for your own memory, never for your users' data. When a user
deletes their account, forget them with `new Geniffy().forgetSpace(...)` from the
[geniffy](https://www.npmjs.com/package/geniffy) SDK.

## Develop

```bash
npm test          # through the AI SDK's own generateText and streamText, with its mock model
npm run check     # the type declarations against the AI SDK's types
```

## Security

Report a vulnerability to ops@geniffy.com, not in a public issue. See the
[security policy](https://github.com/Geniffy/.github/blob/main/SECURITY.md).
