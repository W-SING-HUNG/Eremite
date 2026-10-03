import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { calculateFloatingPosition } from "@/app/_lib/floating-position";
import { clearOverlayStackForTests, isTopOverlay, overlayDepth, registerOverlay } from "@/app/_lib/overlay-stack";
import { detectShortcutPlatform, formatShortcut } from "@/app/_lib/platform-shortcut";
import { nextRovingIndex } from "@/app/_lib/ui-keyboard";

const root = process.cwd();
const componentsRoot = path.join(root, "src", "app", "_components");

assert.deepEqual(nextRovingIndex("ArrowDown", 2, 3), { handled: true, index: 0, activate: false });
assert.deepEqual(nextRovingIndex("ArrowUp", 0, 3), { handled: true, index: 2, activate: false });
assert.deepEqual(nextRovingIndex("Home", 2, 3), { handled: true, index: 0, activate: false });
assert.deepEqual(nextRovingIndex("End", 0, 3), { handled: true, index: 2, activate: false });
assert.deepEqual(nextRovingIndex("Enter", 1, 3), { handled: true, index: 1, activate: true });

const below = calculateFloatingPosition({
  anchor: { top: 20, right: 190, bottom: 50, left: 150, width: 40, height: 30 },
  floating: { width: 180, height: 120 },
  viewport: { width: 240, height: 320 },
  placement: "bottom-end",
});
assert.equal(below.placement, "bottom-end");
assert.ok(below.left >= 8 && below.left + 180 <= 232, "horizontal collision is clamped to the viewport");
const flipped = calculateFloatingPosition({
  anchor: { top: 260, right: 220, bottom: 290, left: 180, width: 40, height: 30 },
  floating: { width: 180, height: 150 },
  viewport: { width: 240, height: 320 },
  placement: "bottom-end",
});
assert.equal(flipped.placement, "top-end", "a bottom popover flips when only the upper side has room");
assert.ok(flipped.top >= 8 && flipped.maxHeight >= 96);

clearOverlayStackForTests();
const removeDialog = registerOverlay("dialog");
const removePopover = registerOverlay("popover");
assert.equal(isTopOverlay("popover"), true);
assert.equal(isTopOverlay("dialog"), false, "only the nested overlay may consume Escape");
assert.equal(overlayDepth("popover"), 2);
removePopover();
assert.equal(isTopOverlay("dialog"), true, "the parent becomes active after its child closes");
removeDialog();
assert.equal(overlayDepth("dialog"), 0);

assert.equal(detectShortcutPlatform("MacIntel"), "mac");
assert.equal(detectShortcutPlatform("Win32"), "windows");
assert.equal(formatShortcut(["mod", "k"], "mac"), "⌘K");
assert.equal(formatShortcut(["mod", "k"], "windows"), "Ctrl+K");
assert.equal(formatShortcut(["shift", "enter"], "windows"), "Shift+Enter");

const [overlay, dialog, popover, menu, select, toast, mutationForm, shell, projectsWorkspace, styles] = await Promise.all([
  read("ui/overlay.tsx"), read("ui/dialog.tsx"), read("ui/popover.tsx"), read("ui/menu.tsx"), read("ui/select.tsx"),
  read("ui/toast.tsx"), read("ui/mutation-form.tsx"), read("workspace-shell.tsx"), read("projects-workspace.tsx"),
  readFile(path.join(root, "src", "app", "styles.css"), "utf8"),
]);

assert.match(overlay, /event\.key !== "Escape"[\s\S]*!isTopOverlay\(id\)/, "Escape is consumed by the top layer only");
assert.match(overlay, /event\.key !== "Tab"[\s\S]*!isTopOverlay\(layerId\)/, "the top modal owns the focus trap");
assert.match(overlay, /document\.addEventListener\("focusin"/, "focus cannot escape a modal through pointer or script focus");
assert.match(overlay, /target\?\.isConnected[\s\S]*target\.focus/, "focus returns only to a still-mounted trigger");
assert.match(overlay, /panelRef\.current\?\.contains\(target\)[\s\S]*triggerRef\?\.current\?\.contains\(target\)/, "outside-click excludes panel and trigger");
assert.match(overlay, /if \(modal \|\| !isTopOverlay\(id\)\) return[\s\S]*const onClick[\s\S]*event\.stopPropagation\(\)/, "modal outside-click closes on click without activating obscured page controls");
assert.match(overlay, /ResizeObserver[\s\S]*addEventListener\("scroll", update, true\)/, "floating layers react to resize and scroll");
assert.match(overlay, /if \(!panel\) return false[\s\S]*requestAnimationFrame\(focusWhenMounted\)/, "modal focus waits for portalled content to mount");
assert.match(overlay, /observer\.observe\(panelRef\.current\)[\s\S]*update\(\)/, "floating layers observe their final portalled size before settling position");
assert.match(dialog, /aria-modal="true"/);
assert.match(dialog, /aria-labelledby=\{titleId\}/);
assert.match(dialog, /aria-describedby=\{description \? descriptionId : undefined\}/);
assert.match(dialog, /role="alertdialog"/);
assert.match(popover, /aria-haspopup": "dialog"/);
assert.match(menu, /aria-haspopup="menu"/);
assert.match(menu, /event\.shiftKey && event\.key === "F10"/, "context menus support the conventional keyboard invocation");
assert.match(menu, /typeaheadRef/, "menus provide typeahead navigation");
assert.match(menu, /isVisiblyFocusable\(target\)[\s\S]*requestAnimationFrame\(focusWhenMounted\)/, "menu focus waits until the portalled panel is visible");
assert.match(projectsWorkspace, /<ContextMenu[\s\S]*ProjectMenuItems/, "a production surface exercises the formal context-menu primitive");
assert.match(select, /aria-haspopup="listbox"/);
assert.match(select, /role="option"[\s\S]*aria-selected=/);
assert.match(toast, /role=\{toast\.tone === "error" \? "alert" : "status"\}/);
assert.match(mutationForm, /if \(pendingRef\.current\) return/, "duplicate submission is rejected synchronously");
assert.match(mutationForm, /aria-busy=\{pending\}/);
assert.match(shell, /<ToastViewport/);

for (const token of ["--control-height-sm", "--control-height-md", "--color-focus", "--color-danger-strong", "--shadow-popover", "--z-dialog", "--z-toast"]) {
  assert.ok(styles.includes(token), `missing design token ${token}`);
}
assert.match(styles, /--z-dialog:\s*80;[\s\S]*--z-popover:\s*90;[\s\S]*--z-toast:\s*100;/, "nested popovers must render above dialogs while toasts remain topmost");
for (const state of [":hover", ":focus-visible", ":active", "[aria-selected=\"true\"]", ":checked", ":disabled", "[aria-invalid=\"true\"]", "[aria-busy=\"true\"]"]) {
  assert.ok(styles.includes(state), `missing formal control state ${state}`);
}
assert.ok(contrast("#e9eeeb", "#111514") >= 4.5, "primary text meets WCAG AA contrast");
assert.ok(contrast("#a6b0ab", "#111514") >= 4.5, "secondary text meets WCAG AA contrast");
assert.ok(contrast("#87938d", "#222a27") >= 4.5, "faint text remains readable on the lightest formal dark surface");
assert.ok(contrast("#f4fff5", "#487f54") >= 4.5, "primary button text meets WCAG AA contrast");
assert.ok(contrast("#ffffff", "#a84840") >= 4.5, "danger button text meets WCAG AA contrast");
assert.doesNotMatch(styles, /appearance:\s*auto/);
assert.doesNotMatch(styles, /\.palette-backdrop|\.restore-confirmation|\.viewer-more\b/, "replaced overlay implementations must not survive in CSS");

const componentFiles = await walk(componentsRoot);
const componentSources = await Promise.all(componentFiles.map(async (file) => [file, await readFile(file, "utf8")]));
const nativeSelects = componentSources.filter(([, source]) => /<select\b/.test(source));
assert.deepEqual(nativeSelects.map(([file]) => path.relative(root, file)), [], "formal UI must not expose browser-native selects");
const interactiveLabels = componentSources.filter(([, source]) => /<label[^>]*>\s*(?:<span[^>]*>[^<]*<\/span>\s*)?<Select\b/.test(source));
assert.deepEqual(interactiveLabels.map(([file]) => path.relative(root, file)), [], "custom pickers must not be nested inside HTML labels");
const rawDialogRoles = componentSources.filter(([file, source]) => !file.endsWith(path.join("ui", "dialog.tsx")) && /role="alert?dialog"/.test(source));
assert.deepEqual(rawDialogRoles.map(([file]) => path.relative(root, file)), [], "screens must use the shared Dialog infrastructure");

console.log("UI primitive regression test passed: tokens, keyboard, focus, overlay stack, collision, ARIA and duplicate-submit contracts.");

async function read(relative) {
  return readFile(path.join(componentsRoot, relative), "utf8");
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]));
  return nested.flat();
}

function contrast(foreground, background) {
  const [a, b] = [foreground, background].map(luminance);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
