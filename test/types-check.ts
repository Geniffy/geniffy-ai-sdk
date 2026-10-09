// Compiles only if the declarations fit the AI SDK's own types (tsc --noEmit, run by npm run check).
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs, streamText } from "ai";
import { geniffyTools, withGeniffy } from "geniffy-ai-sdk";

const model = withGeniffy(anthropic("claude-opus-5-5"), { space: "user_42" });
streamText({ model, prompt: "Hello" });
const inChat = withGeniffy(anthropic("claude-opus-5-5"), { space: "user_42", session: "chat-7", project: "lumen",
                                                         briefing: true, budgetChars: 4000 });
streamText({ model: inChat, prompt: "Hello" });
generateText({ model: anthropic("claude-opus-5-5"), tools: geniffyTools({ space: "user_42" }), stopWhen: stepCountIs(3), prompt: "Hello" });
