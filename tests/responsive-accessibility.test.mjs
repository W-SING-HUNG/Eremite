import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const [styles, inspector, mediaQuery, library, actions, automations, projectContent, tree, mutationForm, select, searchScope, shell, ask, createAction, markdown, text, docx, pdf] = await Promise.all([
  read("src/app/styles.css"),
  read("src/app/_components/ui/responsive-inspector.tsx"),
  read("src/app/_lib/use-media-query.ts"),
  read("src/app/_components/inbox-workspace.tsx"),
  read("src/app/_components/actions-workspace.tsx"),
  read("src/app/_components/automations-workspace.tsx"),
  read("src/app/_components/project-content-workspace.tsx"),
  read("src/app/_components/folder-tree.tsx"),
  read("src/app/_components/ui/mutation-form.tsx"),
  read("src/app/_components/ui/select.tsx"),
  read("src/app/_components/search-scope-form.tsx"),
  read("src/app/_components/workspace-shell.tsx"),
  read("src/app/_components/ask-eremite.tsx"),
  read("src/app/_components/action/action-create-dialog.tsx"),
  read("src/app/_components/file-viewer/renderers/markdown-renderer.tsx"),
  read("src/app/_components/file-viewer/renderers/text-renderer.tsx"),
  read("src/app/_components/file-viewer/renderers/docx-renderer.tsx"),
  read("src/app/_components/file-viewer/renderers/pdf-renderer.tsx"),
]);

assert.match(styles, /@media \(max-width: 1199px\)/);
assert.match(styles, /@media \(max-width: 839px\)/);
for (const obsolete of ["1440px", "1320px", "1100px", "980px", "760px", "720px"]) assert.doesNotMatch(styles, new RegExp(`max-width: ${obsolete}`));
assert.match(styles, /\.responsive-inspector-backdrop/);
// Source contracts only: these assertions do not evaluate fractional viewport layout or FAB visibility.
assert.match(library, /<section className="workspace-view library-view">/u);
assert.match(actions, /<section className="workspace-view actions-view">/u);
assert.match(actions, /useMediaQuery\("\(max-width: 1199px\)"\)/u);
assert.match(styles, /@media \(max-width: 1199px\)\s*\{\s*\.actions-view \.workspace-split\.has-detail:not\(\.previewing\)/u, 'Action Inspector keeps its existing breakpoint source contract');
assert.match(styles, /@media \(width < 1200px\)\s*\{\s*\.library-view \.workspace-split\.has-detail:not\(\.previewing\)\s*\{\s*grid-template-columns: minmax\(0, 1fr\);\s*\}\s*\}/u, 'Content Inspector layout uses the same sub-1200px range as its JS modal query');
assert.match(styles, /\.workspace-content:has\(\.resource-inspector\)\s*~\s*\.ask-eremite-trigger\s*\{\s*display:\s*none;\s*\}/u, 'FAB hide rule targets Content Inspector presence, including inline and suspended modal states');
assert.doesNotMatch(styles, /:has\(\.(?:responsive-inspector-backdrop|action-inspector|run-inspector)\)[^{]*\.ask-eremite-trigger/u, 'other Inspector types do not suppress the global Ask entry');
assert.match(shell, /<main className="workspace-content">\{children\}<\/main>\s*<AskEremite\s*\/>/u, 'workspace content precedes Ask in the shell');
assert.match(ask, /<button className="ask-eremite-trigger [^"]+"/u);
assert.match(inspector, /<aside ref=\{panelRef\} className=\{className\}/u, 'Inspector class stays on the panel when modal is suspended');
assert.match(library, /selected && <ResponsiveInspector[^>]*className="detail-panel resource-inspector"/u, 'Content selection renders the specific Inspector marker');
assert.doesNotMatch(actions + automations, /resource-inspector/u);
assert.match(library, /const restoreInspector = \(\) => setAskInspectorSuspended\(false\)/u);
assert.match(ask, /const closeAsk = \(\) => \{ setOpen\(false\); window\.dispatchEvent\(new Event\('eremite:ask-closed'\)\); \}/u);
assert.match(inspector, /onDismiss: onClose, modal: true, returnFocus: true/u);
assert.match(styles, /\.viewer-back \{[^}]*min-width: 32px;[^}]*min-height: 32px;/);
assert.match(styles, /\.tree-expander \{[^}]*width: 24px;[^}]*height: 30px;/);
assert.match(styles, /\.tag-chip > button \{[^}]*width: 24px;[^}]*height: 24px;/);
assert.match(styles, /--color-text-faint: #87938d/);
assert.match(styles, /\.danger-text \{ color: var\(--color-danger\)/);
assert.doesNotMatch(styles, /workspace-split\.has-detail:not\(\.previewing\)::after|run-inspector-backdrop|run-inspector-host/);

assert.match(inspector, /useDismissableLayer/);
assert.match(inspector, /useFocusScope/);
assert.match(inspector, /role=\{modal \? "dialog"/);
assert.match(inspector, /aria-modal=\{modal \|\| undefined\}/);
assert.match(library, /aria-label="基于当前资料打开 Ask Eremite"/u);
assert.match(library, /modal=\{narrowInspector && !askInspectorSuspended\}/u);
assert.match(library, /useMediaQuery\("\(width < 1200px\)"\)/u, 'Content Inspector source declares the sub-1200px media query');
assert.match(library, /eremite:open-ask-from-inspector/u);
assert.match(library, /eremite:ask-closed/u);
assert.match(library, /type="button" onClick=\{\(\) => \{ setAskInspectorSuspended\(true\)/u, 'Ask entry is a keyboard-operable button inside the Inspector focus scope');
assert.match(library, /router\.replace\(workspaceHref\(context, \{ selected: id/u, 'selection updates the URL context');
assert.doesNotMatch(library, /open-ask-from-inspector[\s\S]{0,120}closeInspector/u, 'opening Ask does not clear Content selection');
assert.match(mediaQuery, /matchMedia/);
for (const surface of [library, actions, automations]) assert.match(surface, /ResponsiveInspector/);
assert.doesNotMatch(automations, /function useMediaQuery/);
assert.match(projectContent, /useDismissableLayer/);
assert.match(projectContent, /useFocusScope/);
assert.match(tree, /role=\{modal \? "dialog"/);
assert.match(tree, /event\.key === "F2"/);

assert.match(mutationForm, /aria-describedby=\{failure \? failureId/);
assert.match(mutationForm, /id=\{failureId\} role="alert"/);
assert.match(select, /describedBy/);
assert.match(searchScope, /id=\{scopeErrorId\}/);
assert.match(searchScope, /describedBy=\{invalid \? scopeErrorId/);
assert.match(shell, /searchError/);
assert.match(shell, /搜索暂时不可用/);
assert.match(createAction, /requestSubmit/);
assert.match(createAction, /event\.ctrlKey \|\| event\.metaKey/);
for (const renderer of [markdown, text, docx, pdf]) assert.match(renderer, /viewer-loading(?: pdf-loading)?" role="status"/);

console.log("Responsive/accessibility source contracts passed: breakpoints, Inspector wiring, target sizes, form error associations, keyboard shortcuts and announced loading markup. Runtime FAB visibility and open/close require separate browser acceptance.");
