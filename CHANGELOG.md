# Changelog

## 0.1.0

The first release.

- `withGeniffy(model, { space })`: what is known about the user goes in front of every model call, after your
  own instructions, and each finished exchange is saved. Streaming and tool loops work as before; Geniffy is
  asked once per question, and only the final answer is saved.
- `geniffyMiddleware(options)`: the same, for `wrapLanguageModel`.
- `geniffyTools({ space })`: `recall` and `remember`, for a model that decides when to look things up.
- A space is required, and a blank or undefined one throws, so one user's memory is never written to another's
  or to your own.
- Built on geniffy 0.2.0, so each call is named in the Geniffy app's Requests page.
