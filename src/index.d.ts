import type { LanguageModel, LanguageModelMiddleware, Tool } from "ai";
import type { Geniffy } from "geniffy";

export interface GeniffyOptions {
  /**
   * Which of your users this is for: one space per user, such as `user_${user.id}`. Required, so that one
   * user's memory is never written to another's. `null` means your own memory, never your users' data; a
   * blank space, or undefined, throws.
   */
  space: string | number | null;
  /** A Geniffy client to use. By default one is made that reads GENIFFY_API_KEY. */
  client?: Geniffy;
  /** A Geniffy API key, when it is not in GENIFFY_API_KEY. Keep it on your server. */
  apiKey?: string;
}

export interface GeniffyMiddlewareOptions extends GeniffyOptions {
  /**
   * The conversation, such as the chat's id: each run is saved into one memory for it, however long it gets.
   * Left out, each run is a memory of its own.
   */
  session?: string;
  /** The project the app works on: the briefing keeps to it, and what is saved is labelled with it. */
  project?: string;
  /**
   * Open with the briefing (default true). `false` reads only what is known that bears on the user's last
   * message. An account without the briefing switched on reads that, either way.
   */
  briefing?: boolean;
  /** The most the briefing adds to the prompt, in characters (500 to 40,000). Default 6,000. */
  budgetChars?: number;
  /** Save each finished run: what the user said, each tool called and its result, and the answer. Default true. */
  remember?: boolean;
  /** What the model is told about the memory block it is given. */
  instructions?: string;
  /** Called when Geniffy can't be reached. The reply goes on without memory. Default: a console warning. */
  onError?: (error: unknown) => void;
}

/**
 * Before each model call, the user's briefing goes in a system message, after your own instructions: where things
 * stand, what is due, the rules that apply, what happened, then what is known that bears on their last message.
 * When the model gives its final answer, the run is saved, tool calls included, into the conversation's memory.
 */
export declare function geniffyMiddleware(options: GeniffyMiddlewareOptions): LanguageModelMiddleware;

/** This package's version, sent with every call so the Requests page shows which integration made it. */
export declare const VERSION: string;
/** The model, wrapped with geniffyMiddleware: `streamText({ model: withGeniffy(model, { space, session }) })`. */
export declare function withGeniffy(model: LanguageModel, options: GeniffyMiddlewareOptions): LanguageModel;

/** `recall` and `remember`, for a model that decides for itself when to look something up or save it. */
export declare function geniffyTools(options: GeniffyOptions): {
  /** Input `{ query: string }`; returns what is known, as text. */
  recall: Tool<{ query: string }, string>;
  /** Input `{ text: string }`; returns "Saved." */
  remember: Tool<{ text: string }, string>;
};

/** The last thing the user said, in a prompt as the AI SDK hands it to a model. */
export declare function lastUserText(prompt: ReadonlyArray<{ role: string; content: unknown }>): string;
