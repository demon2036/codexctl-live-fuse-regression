# Context Usage Role and Responsive Regression Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the injected controls usable at the user's narrow composer width and display a per-role context breakdown whose uncertainty is explicit.

**Architecture:** Keep the runtime overlay body-mounted and read-only. Replace destructive flex shrinking with a responsive `Usage + More` presentation at narrow widths, and derive a role-aware breakdown from the conversation items while reconciling it to the authoritative current-context total. Use the existing isolated Electron fixture as the acceptance surface and require both geometry assertions and a visually inspected screenshot.

**Tech Stack:** Node.js ESM, Electron renderer JavaScript, Chrome DevTools Protocol, `node:test`, existing fake-DOM renderer harness.

**Spec:** In-chat correction from the user on 2026-08-29: screenshot-visible correctness is the acceptance gate and each identifiable role must be reported separately.

## Global Constraints

- Never modify `Codex.app`, `ChatGPT.app`, `app.asar`, official installation files, Codex-owned user data, or the user's running Codex process.
- Test only against fake DOM and a newly launched isolated Electron fixture.
- Preserve exact runtime totals and cache metrics; mark inferred role tokens and shares as `Estimated`.
- Report `System`, `Developer`, `User`, `Assistant`, `Tool`, and `Reasoning` separately. Report `Tool definitions` and `Unclassified` separately because they are context sources, not message roles.
- Add no polling loop, daemon, network proxy, filesystem scraper, `MutationObserver`, or `ResizeObserver`.
- Preserve unrelated changes in the already-dirty worktree and do not commit without a user request.

---

### Task 1: Per-role context model

**Files:**

- Modify: `vendor/prompt-context/renderer/27-usage-metrics.part.js`
- Modify: `vendor/prompt-context/renderer/42-usage-menu.part.js`
- Test: `test/context-usage-panel.test.mjs`

**Interfaces:**

- Consumes: read-only conversation items and authoritative `last.totalTokens`.
- Produces: `metrics.roles = { mode, categories }`, where each category has literal `id`, `label`, `tokens`, and `percent` fields.

- [ ] **Step 1: Write a failing test that catches user/assistant collapsing.** Seed one conversation with system, developer, user, assistant, tool, reasoning, and tool-definition content. Assert literal ordered role ids `system`, `developer`, `user`, `assistant`, `tool`, `reasoning`, `tool_definitions`, `unclassified`; assert token totals reconcile to the literal authoritative total.
- [ ] **Step 2: Run the focused test and verify RED.**

  ```bash
  node --test test/context-usage-panel.test.mjs
  ```

  Expected: failure because the current implementation returns only broad `sources.categories` and merges user/assistant into `messages`.

- [ ] **Step 3: Implement the minimal role classifier.** Classify by explicit role first, then by item type; distribute any runtime aggregate that cannot be split using the observed per-role weights; emit the remainder as `unclassified`; never label the split exact.
- [ ] **Step 4: Render `Role breakdown · Estimated` with every role row and a progress bar.** Keep exact runtime/cache sections unchanged.
- [ ] **Step 5: Run the focused tests and verify GREEN.**

### Task 2: Narrow-width control overflow

**Files:**

- Modify: `vendor/prompt-context/renderer/40-menus.part.js`
- Modify: `vendor/prompt-context/renderer/45-control-style.part.js`
- Modify: `vendor/prompt-context/renderer/50-controls.part.js`
- Modify: `vendor/prompt-context/renderer/10-thread-state.part.js`
- Test: `test/control-host-boundary.test.mjs`
- Test: `test/context-usage-panel.test.mjs`

**Interfaces:**

- Consumes: existing Base, Context, Usage, and Provider menu openers.
- Produces: a narrow-density `More` trigger which exposes Base, Context, and Provider without clipping; Usage remains directly visible.

- [ ] **Step 1: Write failing behavior tests.** Assert that narrow density exposes meaningful `Usage` and `More` labels, that More entries open the existing panels, and that nested `thread.id` / `conversation.id` fields keep Usage available.
- [ ] **Step 2: Run the focused tests and verify RED.**

  ```bash
  node --test test/control-host-boundary.test.mjs test/context-usage-panel.test.mjs
  ```

  Expected: failure because flex children currently shrink to icon-only fragments and Usage requires a top-level `conversationId`.

- [ ] **Step 3: Implement the minimal responsive behavior.** At tight density hide the three secondary direct triggers, show `Usage` and `More` with non-shrinking widths, and route More entries to the existing openers. Show `Usage —` when no safe task id is available.
- [ ] **Step 4: Extend read-only task-id discovery.** Accept exact UUIDs from `threadId`, `thread.id`, `thread.threadId`, `conversation.id`, and `conversation.threadId`; retain the existing `hasConversation=false` fail-closed guard.
- [ ] **Step 5: Run focused tests and verify GREEN.**

### Task 3: Screenshot acceptance gate

**Files:**

- Modify: `test-support/electron-regression-app/index.html`
- Modify: `test-support/electron-regression-app/renderer.js`
- Modify: `scripts/context-usage-screenshot.mjs`
- Modify: `regression/app-cdp.mjs`
- Test: `test/context-usage-panel.test.mjs`

**Interfaces:**

- Consumes: the real assembled renderer payload in a fresh Electron fixture.
- Produces: a screenshot and machine-readable geometry proving the toolbar and expanded role panel are usable.

- [ ] **Step 1: Add failing CDP assertions for the reproduced width.** Require visible non-clipped `Usage` and `More`, hit-test their centers, open the expanded Usage panel, and assert all role labels are visible inside the viewport without covering native microphone/send controls.
- [ ] **Step 2: Run the screenshot script and verify RED.**

  ```bash
  node scripts/context-usage-screenshot.mjs regression-results/context-usage-role-responsive-red.png
  ```

  Expected: failure on the current icon-only/clipped Base, Context, and Provider geometry and missing per-role rows.

- [ ] **Step 3: Make fixture-only sizing changes needed to reproduce the user's 971px-class composer.** Do not weaken production assertions or enlarge the viewport to make the bug disappear.
- [ ] **Step 4: Run the screenshot acceptance and visually inspect the PNG.**

  ```bash
  node scripts/context-usage-screenshot.mjs regression-results/context-usage-role-responsive.png
  ```

  Expected: exit 0, all role rows readable, toolbar labels intact, panel within viewport, native controls unobstructed.

- [ ] **Step 5: Run full verification.**

  ```bash
  node --test test/context-usage-panel.test.mjs test/context-usage-performance.test.mjs test/control-host-boundary.test.mjs
  npm test
  npm run check
  ```

- [ ] **Step 6: Review the scoped diff and report the screenshot path plus exact test counts.**
