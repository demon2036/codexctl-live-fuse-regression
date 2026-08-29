import test from "node:test";
import assert from "node:assert/strict";
import { chooseSidebarScroll } from "../regression/sidebar-scroll.mjs";

test("[PLATFORM-LINUX-RENDERER-SURFACE-005] chooses the real overflowing Sessions viewport", () => {
  const outerShell = { clientHeight: 661, scrollHeight: 661 };
  const sessionsViewport = { clientHeight: 540, scrollHeight: 1200 };

  assert.equal(chooseSidebarScroll([outerShell, sessionsViewport]), sessionsViewport);
});

test("falls back to the largest scrollable surface when no candidate overflows", () => {
  const compact = { clientHeight: 240, scrollHeight: 240 };
  const shell = { clientHeight: 661, scrollHeight: 661 };

  assert.equal(chooseSidebarScroll([compact, shell]), shell);
  assert.equal(chooseSidebarScroll([]), null);
});
