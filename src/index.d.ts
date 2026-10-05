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
  /** Save each finished exchange (the user's message and the final answer). Default true. */
  remember?: boolean;
  /** What the model is told about the memory block it is given. */
  instructions?: string;
  /** Called when Geniffy can't be reached. The reply goes on without memory. Default: a console warning. */
  onError?: (error: unknown) => void;
}

/**
 * Before each model call, what is known about the user that bears on their last message goes in a system
 * message, after your own instructions. When the model gives its final answer, the exchange is saved.
 */
export declare function geniffyMiddleware(options: GeniffyMiddlewareOptions): LanguageModelMiddleware;

/** The model, wrapped with geniffyMiddleware: `streamText({ model: withGeniffy(model, { space }) })`. */
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
