# Ask initialization Enter repair — 2026-10-15

Pressing Enter immediately after opening Ask previously prevented the textarea's default action while initialization was loading, without preserving a send request. Initialization reads the Provider/conversation list before loading the selected conversation and its revision. Sending before both complete could select an old conversation or create an unnecessary new one.

The composer now records one explicit non-composing Enter request while initialization is loading and displays waiting feedback. It dispatches once after successful initialization. Failure or an unavailable Provider preserves the input and displays feedback. Editing, closing, changing context or selecting another conversation cancels the old request. Selection generations guard late initialization responses and the asynchronous conversation creation before dispatch.

Shift+Enter remains a newline. Composing Enter and key code 229 do not send or queue a request. The Send button, SDK stream, Stop, and Host-owned AI contracts retain their existing boundaries. This change has no schema, migration, Runtime, Tool, Supplier, package version or release impact.

## Regression coverage

`tests/ask-eremite-initialization.test.mjs` is a supplemental production-browser gate using an installed Playwright module, real Chrome, isolated application data and a loopback fixture Provider. It controls when initialization responses are released. It covers:

- Immediate and repeated Enter across delayed Provider/list and selected-conversation responses: one send to the loaded conversation.
- List failure, conversation failure and unavailable Provider: no sends, preserved input and clear feedback.
- Closing/reopening and editing: cancelled requests are not replayed.
- A late old response after another conversation is selected: no overwritten selection or stale send.
- Enter during a delayed conversation switch: one send to the newly selected conversation.
- A stale running state on reopen: initialization Enter is retained until the actual conversation loads.
- Shift+Enter and `compositionstart`/`compositionupdate`/composing Enter/`compositionend`, plus non-composing 229: no accidental sends; Send, streaming and Stop remain functional.
- Empty history: one new conversation despite repeated Enter.
- Closing during automatic conversation creation: no dispatch and preserved input.

Set `EREMITE_PLAYWRIGHT_MODULE` and `EREMITE_BROWSER_EXECUTABLE` to the local installations, use isolated TEMP/TMP, build the production application, then run:

```powershell
node --import ./tests/register-typescript-loader.mjs tests/ask-eremite-initialization.test.mjs
```

The fixture creates and removes its own isolated `EREMITE_DATA_DIR`; no real user data or external Provider is needed. The browser gate remains separate from the browser-free generic verification chain. The existing accessibility source test still requires closing Ask to dispatch the Inspector restoration event, while allowing the new cancellation logic before closing.

## Validation boundaries

Local production Chrome regression: 12/12 PASS, with no uncaught browser errors. Targeted Ask/accessibility tests, typecheck, production build and public-state validation: PASS. Repository CI runs the complete Host verification against the retained public dependency and security baseline.

Real external Provider behavior, manual native input-method acceptance and independent product acceptance are NOT VERIFIED. Automated composition events cover the requested Enter safety check. These local results do not claim whole-product absence of defects or create a new software release.
