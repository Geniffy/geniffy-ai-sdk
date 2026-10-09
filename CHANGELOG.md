# Changelog

## 0.2.0

- **The briefing.** Before every model call the model gets the user's briefing: where things stand, what is due or
  was promised, the rules that apply, what happened, then what is known that bears on their last message, each line
  dated. `project` keeps it to one project, `budgetChars` caps it, and `briefing: false` reads only what bears on the
  question, as 0.1 did. An account without the briefing switched on gets that too, and the briefing is tried again
  ten minutes later. A briefing with nothing in it yet says so, so the model never reads silence as permission to
  guess.
- **The whole run is saved, tool calls included**: what the user said, each tool the model called and what it
  returned, and the answer. `session` (the chat's id) makes a conversation one memory however long it gets; the
  history an app sends with every request is not saved again. 0.1 saved only the last question and answer, each as a
  memory of its own. A tool's output and a call's input are cut to what Geniffy keeps before they are sent.
- Needs `geniffy` 0.4.0 or later.

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
