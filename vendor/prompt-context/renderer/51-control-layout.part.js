  const controlRectSnapshot = (rect) => ({
    left: Number(rect?.left) || 0,
    top: Number(rect?.top) || 0,
    width: Number(rect?.width) || 0,
    height: Number(rect?.height) || 0,
  });

  const sameControlRect = (left, right) => Boolean(left && right
    && left.left === right.left && left.top === right.top
    && left.width === right.width && left.height === right.height);

  function syncControlAnchor(permissionButton = null, rect = null) {
    state.controlAnchor = permissionButton;
    state.controlAnchorRect = rect ? controlRectSnapshot(rect) : null;
  }

  const hitTestIncludes = (element, rect) => {
    if (typeof document.elementFromPoint !== "function") return true;
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hits = typeof document.elementsFromPoint === "function"
      ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)];
    const hit = Array.from(hits ?? []).find((candidate) => candidate
      && candidate !== state.controlHost && !state.controlHost?.contains?.(candidate));
    return hit === element || Boolean(hit && element.contains?.(hit));
  };

  function resetControlLayoutState() {
    if (state.controlLayoutFrame != null) cancelAnimationFrame(state.controlLayoutFrame);
    state.controlPositionQueued = false;
    state.controlLayoutCheckQueued = false;
    state.controlLayoutFrame = null;
    state.controlAnchorRect = null;
  }

  function scheduleControlLayoutCheck() {
    if (state.stopped || state.controlLayoutCheckQueued || !state.controlAnchorRect) return;
    state.controlLayoutCheckQueued = true;
    let previous = state.controlAnchorRect;
    let changed = false;
    let stableFrames = 0;
    let remainingFrames = 36;
    const finish = () => {
      state.controlLayoutCheckQueued = false;
      state.controlLayoutFrame = null;
      if (changed) scheduleControlPosition();
    };
    const check = () => {
      state.controlLayoutFrame = null;
      if (state.stopped) {
        state.controlLayoutCheckQueued = false;
        return;
      }
      if (!state.controlAnchor?.isConnected) {
        state.controlLayoutCheckQueued = false;
        scheduleEnsure();
        return;
      }
      const current = controlRectSnapshot(state.controlAnchor.getBoundingClientRect());
      if (sameControlRect(previous, current)) stableFrames += 1;
      else {
        previous = current;
        changed = true;
        stableFrames = 0;
      }
      remainingFrames -= 1;
      if (stableFrames >= 2 || remainingFrames <= 0) finish();
      else {
        const frame = requestAnimationFrame(check);
        if (state.controlLayoutCheckQueued) state.controlLayoutFrame = frame;
      }
    };
    const frame = requestAnimationFrame(check);
    if (state.controlLayoutCheckQueued) state.controlLayoutFrame = frame;
  }

  const onDocumentPointerDown = (event) => {
    const sessionsSidebar = event.target?.closest?.("aside.app-shell-left-panel");
    if (sessionsSidebar) state.navigationHandler?.();
    else {
      const footer = state.controlAnchor?.closest?.('[data-composer-footer-responsive]');
      if (!state.controlHost?.contains?.(event.target) && !footer?.contains?.(event.target)) {
        scheduleControlLayoutCheck();
      }
    }
    if (!state.menu) return;
    if (state.menu.contains(event.target) || state.menuButton?.contains(event.target)) return;
    closeMenu();
  };
