import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAppInteractions } from "../regression/app-interactions.mjs";

function valid() {
  return {
    prompt: {
      defaultVisible: true, historicalPreserved: true, menuReachable: true,
      oneShotFirst: true, oneShotSecondClean: true, resetToDefault: true,
    },
    context: {
      activeAppliedBeforeTurn: true, activeCoalescedWindow: 600000,
      activeLabelCurrentThread: true, copyClean: true, failureRolledBack: true,
      idempotentNoRequest: true, immediateOrder: "thread/read,thread/unsubscribe,thread/resume",
      largeCompact: 400000, largeVerified: true, largeWindow: 450000,
      nativeNoOverride: true, oaiEffective: 258400, oaiWindow: 272000,
      retryRecovered: true, shrinkApplied: true,
    },
    layout: { initialAligned: true, multilineAligned: true, moved: true },
    stress: {
      graphAttempts: 1, hotListeners: { beforeinput: 0, input: 0, scroll: 0 },
      inputEnsureDelta: 0, inputPositionDelta: 0, navigationEndTimers: 0,
      navigationPeakTimers: 2, observerCount: 0, scopedObserverCount: 0, settledTimerCount: 0,
      wallpaperDeltaZero: true, workerCount: 0,
    },
  };
}

test("complete Prompt/Context App interaction contract passes", () => {
  assert.deepEqual(evaluateAppInteractions(valid()), { failures: [], status: "pass" });
});

test("one-shot, Context ordering, mapping, anchor, and hot-path regressions fail", () => {
  for (const mutate of [
    (value) => { value.prompt.oneShotSecondClean = false; },
    (value) => { value.context.immediateOrder = "thread/resume"; },
    (value) => { value.context.oaiEffective = 450000; },
    (value) => { value.layout.multilineAligned = false; },
    (value) => { value.stress.inputEnsureDelta = 1; },
  ]) {
    const value = valid();
    mutate(value);
    assert.equal(evaluateAppInteractions(value).status, "fail");
  }
});
