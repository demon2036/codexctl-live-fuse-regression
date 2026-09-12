  const syncControlOwnerObserver = (context = null) => {
    // Keep the last local owner while it is temporarily hidden or detached.
    // Observe its direct parent for replacement, never the conversation tree.
    const root = context?.footer ?? state.controlOwnerObserverRoot;
    const parent = context?.footer?.parentElement ?? state.controlOwnerObserverParent;
    if (root === state.controlOwnerObserverRoot && parent === state.controlOwnerObserverParent) return;
    state.controlOwnerObserver?.disconnect();
    state.controlOwnerObserverRoot = root;
    state.controlOwnerObserverParent = parent;
    if (!root || typeof MutationObserver !== "function") return;
    if (!state.controlOwnerObserver) state.controlOwnerObserver = new MutationObserver((records) => {
      if (state.stopped) return;
      const root = state.controlOwnerObserverRoot;
      const parent = state.controlOwnerObserverParent;
      const relevant = records.some((record) => {
        if (state.controlComposer?.contains?.(record.target)) return false;
        if (record.target !== parent) return true;
        return record.type === "attributes" || [...record.addedNodes, ...record.removedNodes]
          .some((node) => node === root || node.matches?.('[data-composer-footer-responsive]'));
      });
      if (!relevant) return;
      if (!state.controlComposer?.isConnected || !state.controlFooter?.isConnected
        || !state.controlAnchor?.isConnected) scheduleEnsure();
      else scheduleControlPosition();
    });
    const attributeFilter = ["class", "style", "hidden", "aria-hidden"];
    state.controlOwnerObserver.observe(root, {
      childList: true, subtree: true, attributes: true, attributeFilter,
    });
    if (parent) state.controlOwnerObserver.observe(parent, {
      childList: true, attributes: true, attributeFilter,
    });
  };
  const syncControlResizeObserver = (context = null, protectedNodes = []) => {
    const targets = new Set(context ? [
      context.composer, context.footer, context.permissionButton, ...protectedNodes,
    ] : []);
    for (let element = context?.footer?.parentElement;
      element && element !== document.body; element = element.parentElement) targets.add(element);
    const next = [...targets].filter((element) => element?.isConnected !== false);
    if (next.length === state.controlResizeTargets.length
      && next.every((target, index) => target === state.controlResizeTargets[index])) return;
    state.controlResizeObserver?.disconnect();
    state.controlResizeTargets = next;
    state.controlResizeWidths.clear();
    if (!next.length || typeof ResizeObserver !== "function") return;
    if (!state.controlResizeObserver) state.controlResizeObserver = new ResizeObserver(() => {
      if (!state.stopped) scheduleControlPosition();
    });
    for (const target of next) state.controlResizeObserver.observe(target);
  };
