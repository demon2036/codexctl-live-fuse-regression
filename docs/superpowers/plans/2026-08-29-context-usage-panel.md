# Context Usage Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkboxes so progress stays reviewable.

**Goal:** Add a portable, non-persistent Context Usage panel that reports authoritative context and prompt-cache metrics, an honest context-source breakdown, and compaction history without modifying Codex Desktop itself.

**Architecture:** Extend the existing `codexctl` renderer payload with pure usage-normalization and conversation-analysis helpers, then mount one body-level Usage control and popover beside the existing Prompt/Context controls. Read only the already-discovered in-memory conversation manager; install no polling or document-wide observers. Exact runtime fields win. Source categories fall back to a clearly labelled estimate derived from visible conversation items and scaled to the authoritative current-context total.

**Tech Stack:** Node.js ESM, Electron renderer JavaScript, `node:test`, existing fake-DOM renderer harness, existing isolated Electron regression fixture.

**Spec:** In-chat design approved 2026-08-29.

## Global Constraints

- [ ] Never edit, replace, re-sign, unpack-and-repack, or persist changes inside `Codex.app`, `app.asar`, the Codex installation directory, or Codex-owned user data.
- [ ] Never depend on a patched official bundle. The shipped implementation must live entirely in `codexctl` and work as a removable runtime overlay on another compatible machine.
- [ ] Treat the conversation manager as read-only for statistics. Do not mutate conversation, turn, item, usage, cache, or compaction objects.
- [ ] Do not add a daemon, filesystem scraper, network proxy, recurring timer, `MutationObserver`, or `ResizeObserver` for the panel.
- [ ] Test only in the repository's isolated fake DOM and Electron regression app; do not inject into the user's currently running Codex App.
- [ ] Label inferred source percentages as `Estimated`; show unavailable values rather than inventing precision.

## Task 1: Usage normalization and exact cache metrics

**Files:**

- Create: `vendor/prompt-context/renderer/27-usage-metrics.part.js`
- Modify: `src/runtime.mjs`
- Test: `test/context-usage-panel.test.mjs`

- [ ] Add a failing test for the current snake_case rollout shape and the expected values `206,242 / 258,400`, `79.81%`, `200,192 / 204,944`, `97.68%`, cumulative `95.08%`, and uncached `4,752`.
- [ ] Add failing tests for camelCase desktop fields, zero input, missing values, and totals that exceed the window.
- [ ] Implement alias-tolerant finite non-negative numeric normalization.
- [ ] Expose a read-only `usageMetricsForThread()` diagnostic helper.
- [ ] Run the focused tests.

## Task 2: Context-source and compaction analysis

**Files:**

- Modify: `vendor/prompt-context/renderer/27-usage-metrics.part.js`
- Test: `test/context-usage-panel.test.mjs`

- [ ] Add failing tests for exact source breakdown fields when supplied by the runtime.
- [ ] Add failing tests for classification of messages, tool calls/results, reasoning, developer/system instructions, and tool definitions from conversation data.
- [ ] Scale estimated categories to authoritative current-context tokens and mark the result `estimated`.
- [ ] Count `contextCompaction`, `context-compaction`, and `context_compaction` items and compute turns since the latest compaction.
- [ ] Run the focused tests.

## Task 3: Usage trigger and popover

**Files:**

- Create: `vendor/prompt-context/renderer/42-usage-menu.part.js`
- Modify: `vendor/prompt-context/renderer/45-control-style.part.js`
- Modify: `vendor/prompt-context/renderer/50-controls.part.js`
- Modify: `vendor/prompt-context/renderer/60-lifecycle.part.js`
- Modify: `vendor/prompt-context/renderer/15-request-client.part.js`
- Test: `test/context-usage-panel.test.mjs`
- Test: `test/prompt-performance.test.mjs`

- [ ] Add a failing DOM test for a compact `Usage 79.8%` trigger and a popover containing Current context, Prompt cache, Context sources, and Compaction.
- [ ] Preserve the existing Context selector; the new Usage control owns the statistics popover.
- [ ] Render exact token values with thousands separators, percentages with two decimals, compact progress bars, and an explicit exact/estimated badge.
- [ ] Refresh only on panel open, existing request-repair events, `thread/tokenUsage/updated`, `thread/compacted`, and turn completion.
- [ ] Close and remove the popover/control during navigation cleanup and payload reinjection.
- [ ] Assert no new observers or steady-state timers.

## Task 4: Portability and non-intrusion contracts

**Files:**

- Test: `test/context-usage-panel.test.mjs`
- Modify: `README.md`

- [ ] Assert the renderer payload contains no Codex installation write, asar packing, signing, or bundle-replacement operations.
- [ ] Document that statistics are a temporary overlay, exact fields depend on the compatible runtime object, and source fallback is estimated.
- [ ] Document that `codexctl` neither modifies nor redistributes Codex Desktop resources.

## Task 5: Isolated UI verification

**Files:**

- Modify: `test-support/electron-regression-app/renderer.js`
- Modify: `test-support/electron-regression-app/index.html` only if fixture layout needs room
- Modify: the existing browser/Electron regression script used to capture the control surface

- [ ] Seed the isolated fixture with representative usage and compaction data.
- [ ] Open the Usage panel in the fixture, capture a screenshot, and visually check spacing, clipping, contrast, numeric alignment, and source labels.
- [ ] Confirm the user's live Codex process was never targeted.

## Task 6: Full verification and review

- [ ] Run the focused context-usage test file.
- [ ] Run `npm test`.
- [ ] Run `npm run check`.
- [ ] Run the isolated Electron/browser regression relevant to the control overlay.
- [ ] Review `git diff` only for intended files, preserving all pre-existing changes.
- [ ] Report exact versus estimated fields, verification commands, screenshot path, and the non-intrusion guarantee.
