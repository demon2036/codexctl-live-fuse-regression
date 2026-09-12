// Counts come from inspecting active DOM observation targets in the fixture.
export function validControlObservations(metrics, enabled = true) {
  const count = metrics?.observerCount;
  return Number.isSafeInteger(count) && count >= 0
    && count === metrics?.scopedObserverCount && count <= (enabled ? 2 : 0);
}
