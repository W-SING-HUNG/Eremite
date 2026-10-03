import assert from "node:assert/strict";
import { resolvePaletteKey } from "@/app/_lib/command-palette-keyboard";

assert.deepEqual(resolvePaletteKey("ArrowDown", 0, 5), { handled: true, activeIndex: 1, execute: false, close: false });
assert.deepEqual(resolvePaletteKey("ArrowDown", 4, 5), { handled: true, activeIndex: 0, execute: false, close: false });
assert.deepEqual(resolvePaletteKey("ArrowUp", 0, 5), { handled: true, activeIndex: 4, execute: false, close: false });
assert.deepEqual(resolvePaletteKey("Enter", 2, 5), { handled: true, activeIndex: 2, execute: true, close: false });
assert.deepEqual(resolvePaletteKey("Enter", 8, 2), { handled: true, activeIndex: 1, execute: true, close: false });
assert.deepEqual(resolvePaletteKey("Escape", 3, 5), { handled: true, activeIndex: 0, execute: false, close: true });
assert.deepEqual(resolvePaletteKey("a", 2, 5), { handled: false, activeIndex: 2, execute: false, close: false });
assert.deepEqual(resolvePaletteKey("ArrowDown", 0, 0), { handled: false, activeIndex: 0, execute: false, close: false });

console.log("Command palette keyboard test passed.");
