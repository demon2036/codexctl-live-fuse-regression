  const CONTROL_ANCHOR_ATTRIBUTE = "data-codexctl-control-anchor";
  // The native context-usage circle is an image-role tooltip trigger.
  const CONTROL_NATIVE_SELECTOR = ["button", '[role="button"]', "input", "select", "textarea", "[tabindex]",
    "[data-composer-navigation-target]", '[role="img"]',
  ].join(",");
  const CONTROL_OWNER_SIGNAL_SELECTOR = [
    '[data-composer-footer-responsive]', '[data-codex-composer="true"]',
    '[data-composer-navigation-target="permissions"]', CONTROL_NATIVE_SELECTOR,
  ].join(",");
  const controlRectSnapshot = (rect) => ({
    bottom: Number(rect?.bottom) || 0,
    height: Number(rect?.height) || 0,
    left: Number(rect?.left) || 0,
    right: Number(rect?.right) || 0,
    top: Number(rect?.top) || 0,
    width: Number(rect?.width) || 0,
  });
  const sameControlNumber = (left, right) => Math.abs(Number(left) - Number(right)) <= 0.5;
  const sameControlRect = (left, right) => Boolean(left && right
    && ["left", "top", "right", "bottom", "width", "height"]
      .every((key) => sameControlNumber(left[key], right[key])));
  const controlContentKey = () => [...(state.controlHost?.children ?? [])]
    .filter((node) => node.classList?.contains("cbps-control"))
    .map((node) => node.dataset?.cbpsRenderKey ?? node.dataset?.composerNavigationTarget ?? "")
    .join("\u0000");
  const layoutVisible = (element) => {
    if (!element || element.isConnected === false
      || element.getAttribute?.("aria-hidden") === "true") return false;
    let style = null;
    let rect = null;
    try { style = window.getComputedStyle(element); } catch {}
    try { rect = element.getBoundingClientRect(); } catch {}
    const opacity = Number(style?.opacity ?? 1);
    return style?.display !== "none" && style?.visibility !== "hidden"
      && Number.isFinite(opacity) && opacity > 0.05 && rectInViewport(rect);
  };
  const hitTestIncludes = (element, rect) => {
    if (typeof document.elementFromPoint !== "function") return true;
    const hits = typeof document.elementsFromPoint === "function"
      ? document.elementsFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      : [document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)];
    const hit = Array.from(hits ?? []).find((candidate) => candidate
      && candidate !== state.controlHost && !state.controlHost?.contains?.(candidate)
      && candidate !== state.menu && !state.menu?.contains?.(candidate)
      && candidate !== state.toast && !state.toast?.contains?.(candidate));
    return hit === element || Boolean(hit && element.contains?.(hit));
  };
  const controlRectsOverlap = (left, right) => Math.min(left.right, right.right)
    - Math.max(left.left, right.left) > 0.5
    && Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 0.5;
  const controlRectInside = (inner, outer) => inner.left >= outer.left - 0.5
    && inner.top >= outer.top - 0.5 && inner.right <= outer.right + 0.5
    && inner.bottom <= outer.bottom + 0.5;
  const cssPixel = (value) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const footerInnerRect = (footer) => {
    const rect = controlRectSnapshot(footer.getBoundingClientRect());
    const style = window.getComputedStyle(footer);
    return {
      // Native action strips may live in reserved padding. The border bounds
      // and protected native hit targets define usable space, not the content box.
      left: rect.left + cssPixel(style.borderLeftWidth),
      top: rect.top + cssPixel(style.borderTopWidth),
      right: rect.right - cssPixel(style.borderRightWidth),
      bottom: rect.bottom - cssPixel(style.borderBottomWidth),
    };
  };
  const nativeProtectedNodes = (context) => [...context.footer.querySelectorAll(
    CONTROL_NATIVE_SELECTOR,
  )].filter((element) => element !== context.permissionButton
    && !context.permissionButton.contains?.(element)
    && !context.composer.contains?.(element)
    && !state.controlHost?.contains?.(element)
    && layoutVisible(element));
  const nativeNodeSignature = (node) => {
    let style = null;
    try { style = window.getComputedStyle(node); } catch {}
    return {
      node,
      rect: controlRectSnapshot(node.getBoundingClientRect()),
      display: style?.display ?? null,
      visibility: style?.visibility ?? null,
      ariaHidden: node.getAttribute?.("aria-hidden"),
      clientWidth: Number(node.clientWidth) || 0,
      scrollWidth: Number(node.scrollWidth) || 0,
    };
  };
  const sameNativeSignature = (left, right) => Boolean(left && right
    && left.node === right.node && sameControlRect(left.rect, right.rect)
    && left.display === right.display && left.visibility === right.visibility
    && left.ariaHidden === right.ariaHidden && left.clientWidth === right.clientWidth
    && left.scrollWidth === right.scrollWidth);
  const nativeBaseline = (context) => {
    const protectedNodes = nativeProtectedNodes(context);
    const rowStyle = window.getComputedStyle(context.permissionButton.parentElement);
    const gap = Math.max(0, cssPixel(rowStyle.columnGap === "normal"
      ? rowStyle.gap : rowStyle.columnGap));
    return {
      context,
      contentKey: controlContentKey(),
      footer: nativeNodeSignature(context.footer),
      footerInner: footerInnerRect(context.footer),
      permission: nativeNodeSignature(context.permissionButton),
      protected: protectedNodes.map(nativeNodeSignature),
      hitNodes: new Set([context.permissionButton, ...protectedNodes]),
      gap,
    };
  };
  const nativeBaselineMatches = (baseline) => baseline.footer.node.isConnected
    && baseline.permission.node.isConnected
    && sameNativeSignature(baseline.footer, nativeNodeSignature(baseline.footer.node))
    && sameNativeSignature(baseline.permission, nativeNodeSignature(baseline.permission.node))
    && baseline.protected.every((entry) => entry.node.isConnected
      && sameNativeSignature(entry, nativeNodeSignature(entry.node)));
  const nativeGeometryKey = (baseline) => [
    baseline.contentKey, baseline.gap,
    ...[baseline.footer, baseline.permission, ...baseline.protected].flatMap((entry) => [
      entry.rect.left, entry.rect.top, entry.rect.width, entry.rect.height,
      entry.clientWidth, entry.scrollWidth,
    ].map((value) => Number(value).toFixed(2))),
  ].join("|");
  const restoreControlAttribute = (element, name, value) => {
    if (value == null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  };
  const measurableControlNodes = (host) => [...host.children].filter((node) => {
    if (!node.classList?.contains("cbps-control")) return false;
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== "none" && rect.width > 0 && rect.height > 0;
  });
  const candidatePlacement = (candidate, baseline) => {
    const left = baseline.permission.rect.right + baseline.gap;
    const top = baseline.permission.rect.top
      + (baseline.permission.rect.height - candidate.height) / 2;
    const host = {
      left, top, right: left + candidate.width, bottom: top + candidate.height,
      width: candidate.width, height: candidate.height,
    };
    const controls = candidate.controls.map((rect) => ({
      left: left + rect.left, top: top + rect.top,
      right: left + rect.right, bottom: top + rect.bottom,
      width: rect.width, height: rect.height,
    }));
    return { host, controls };
  };
  const controlProbePoints = (rect) => {
    const insetX = Math.min(2, rect.width / 4);
    const insetY = Math.min(2, rect.height / 4);
    return [
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
      [rect.left + insetX, rect.top + insetY],
      [rect.right - insetX, rect.top + insetY],
      [rect.left + insetX, rect.bottom - insetY],
      [rect.right - insetX, rect.bottom - insetY],
    ];
  };
  const protectedNativeHit = (x, y, baseline) => {
    if (typeof document.elementFromPoint !== "function") return true;
    const hits = typeof document.elementsFromPoint === "function"
      ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)];
    return Array.from(hits ?? []).some((hit) => {
      if (!hit || state.controlHost?.contains?.(hit)
        || hit.closest?.('[data-codex-control-overlay="true"]')) return false;
      const target = hit.closest?.(CONTROL_NATIVE_SELECTOR);
      return Boolean(target && baseline.hitNodes.has(target));
    });
  };
  const controlRectsHitNative = (rects, baseline) => rects.some((rect) =>
    controlProbePoints(rect).some(([x, y]) => protectedNativeHit(x, y, baseline)));
  const candidateFits = (candidate, baseline) => {
    if (!(candidate.width > 0 && candidate.height > 0) || !candidate.controls.length) return false;
    const placement = candidatePlacement(candidate, baseline);
    return controlRectInside(placement.host, baseline.footerInner)
      && placement.controls.every((rect) => baseline.protected.every((native) =>
        !controlRectsOverlap(rect, native.rect)))
      && !controlRectsHitNative(placement.controls, baseline);
  };
  const setControlCandidate = (host, candidate, baseline) => {
    const placement = candidatePlacement(candidate, baseline);
    if (state.menu?.classList.contains("cbps-overflow-menu")
      && (host.dataset.cbpsPresentation !== candidate.presentation
        || (host.dataset.cbpsInline ?? "") !== (candidate.inline ?? ""))) closeMenu();
    setAttributeIfChanged(host, "data-cbps-presentation", candidate.presentation);
    setAttributeIfChanged(host, "data-cbps-density", candidate.density);
    setAttributeIfChanged(host, "data-cbps-inline", candidate.inline ?? "");
    setAttributeIfChanged(host, "data-cbps-active-candidate", candidate.key);
    Object.assign(host.style, {
      left: `${placement.host.left}px`, top: `${placement.host.top}px`,
      width: "max-content", maxWidth: `${candidate.width}px`,
    });
    host.hidden = false;
  };
  const actualControlLayoutSafe = (host, candidate, baseline) => {
    if (!nativeBaselineMatches(baseline)) return false;
    const hostRect = controlRectSnapshot(host.getBoundingClientRect());
    const controls = measurableControlNodes(host).map((node) =>
      controlRectSnapshot(node.getBoundingClientRect()));
    if (!controlRectInside(hostRect, baseline.footerInner)
      || controls.length !== candidate.controls.length
      || controls.some((rect) => baseline.protected.some((native) =>
        controlRectsOverlap(rect, native.rect)))) return false;
    host.setAttribute("data-cbps-probing", "true");
    const safe = !controlRectsHitNative(controls, baseline);
    host.removeAttribute("data-cbps-probing");
    return safe;
  };
  const applyControlCandidate = (host, requested, candidates, safeKeys, baseline, veto) => {
    for (let index = requested?.index ?? candidates.length; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      if (!safeKeys.has(candidate.key)) continue;
      setControlCandidate(host, candidate, baseline);
      if (actualControlLayoutSafe(host, candidate, baseline)) return candidate;
      veto.keys.add(candidate.key);
    }
    host.hidden = true;
    host.removeAttribute("data-cbps-active-candidate");
    return null;
  };
  const restoreControlAnchor = () => {
    const anchor = state.controlAnchor;
    const original = state.controlAnchorOriginal;
    if (anchor && original) {
      if (original.present) anchor.setAttribute(CONTROL_ANCHOR_ATTRIBUTE, original.value);
      else anchor.removeAttribute(CONTROL_ANCHOR_ATTRIBUTE);
    }
    state.controlAnchor = null;
    state.controlAnchorOriginal = null;
  };
  const clearControlPromotion = () => { state.controlPromotion = null; };
  const syncControlOwner = (context = null) => {
    const changed = state.controlAnchor !== (context?.permissionButton ?? null)
      || state.controlComposer !== (context?.composer ?? null)
      || state.controlFooter !== (context?.footer ?? null);
    if (!changed) return false;
    if (state.menu) closeMenu();
    restoreControlAnchor();
    state.controlAnchor = context?.permissionButton ?? null;
    state.controlComposer = context?.composer ?? null;
    state.controlFooter = context?.footer ?? null;
    state.controlOwnerSettling = context ? { key: null, frames: 0 } : null;
    state.controlVeto = null;
    clearControlPromotion();
    return true;
  };
  const scheduleControlFrame = () => {
    if (state.stopped || state.controlLayoutFrame != null) return;
    state.controlLayoutFrame = requestAnimationFrame(() => {
      state.controlLayoutFrame = null;
      scheduleControlPosition();
    });
  };
  const settledControlOwner = (baseline) => {
    const pending = state.controlOwnerSettling;
    if (!pending && !state.controlHostReparented) return true;
    const key = nativeGeometryKey(baseline);
    if (!pending || pending.key !== key) state.controlOwnerSettling = { key, frames: 0 };
    else state.controlOwnerSettling.frames += 1;
    if (state.controlOwnerSettling.frames >= 2) {
      state.controlOwnerSettling = null;
      state.controlHostReparented = false;
      return true;
    }
    scheduleControlFrame();
    return false;
  };
  const stablePromotionCandidate = (selected, current, safeKeys, baseline, candidates) => {
    if (!selected || !current || current.index <= selected.index || !safeKeys.has(current.key)) {
      clearControlPromotion();
      return selected;
    }
    const key = `${nativeGeometryKey(baseline)}|${candidates.map((entry) =>
      `${entry.key}:${entry.width.toFixed(2)}:${entry.height.toFixed(2)}`).join("|")}|${selected.key}`;
    if (state.controlPromotion?.key === key) state.controlPromotion.frames += 1;
    else state.controlPromotion = { key, frames: 0 };
    if (state.controlPromotion.frames >= 2) {
      clearControlPromotion();
      return selected;
    }
    scheduleControlFrame();
    return current;
  };
  function layoutControlHost(context, host) {
    if (!context) {
      // A transient hide is not an owner change. Keep the existing local
      // observations and restore immediately once its geometry is safe again.
      host.hidden = true;
      clearControlPromotion();
      return null;
    }
    syncControlOwner(context);
    syncControlOwnerObserver(context);
    const baseline = nativeBaseline(context);
    syncControlResizeObserver(context, baseline.protected.map((entry) => entry.node));
    if (!settledControlOwner(baseline)) {
      host.hidden = true;
      return null;
    }
    const candidates = measureControlPresentations(host, baseline);
    // A route transition can briefly move native controls while React preserves
    // the same footer nodes and geometry. Keep failed candidates local to this
    // pass so a transient hit-test cannot permanently pin the footer to More.
    const passVeto = { keys: new Set() };
    host.setAttribute("data-cbps-probing", "true");
    const safe = candidates.filter((candidate) => candidateFits(candidate, baseline));
    host.removeAttribute("data-cbps-probing");
    const safeKeys = new Set(safe.map((candidate) => candidate.key));
    const selected = safe[0] ?? null;
    const current = candidates.find((candidate) =>
      candidate.key === host.dataset.cbpsActiveCandidate) ?? null;
    const requested = stablePromotionCandidate(selected, current, safeKeys, baseline, candidates);
    const applied = requested
      ? applyControlCandidate(host, requested, candidates, safeKeys, baseline, passVeto) : null;
    if (!applied) {
      host.hidden = true;
      host.removeAttribute("data-cbps-active-candidate");
    }
    state.controlAnchorRect = {
      footer: baseline.footer.rect,
      permission: baseline.permission.rect,
      selected: applied?.key ?? "hidden",
      proposed: selected?.key ?? "hidden",
      protectedCount: baseline.protected.length,
      candidates: Object.fromEntries(candidates.map((candidate) => [candidate.key, {
        width: candidate.width, height: candidate.height, safe: safeKeys.has(candidate.key),
      }])),
    };
    return applied;
  }
  function resetControlLayoutState() {
    if (state.controlLayoutFrame != null) cancelAnimationFrame(state.controlLayoutFrame);
    state.controlResizeObserver?.disconnect();
    state.controlOwnerObserver?.disconnect();
    state.controlResizeObserver = null;
    state.controlOwnerObserver = null;
    state.controlOwnerObserverRoot = null;
    state.controlOwnerObserverParent = null;
    state.controlResizeTargets = [];
    state.controlResizeWidths.clear();
    state.controlPositionQueued = false;
    state.controlLayoutFrame = null;
    state.controlAnchorRect = null;
    state.controlFooter = null;
    state.controlOwnerSettling = null;
    state.controlHostReparented = false;
    state.controlVeto = null;
    clearControlPromotion();
    restoreControlAnchor();
  }
  const nativeFooterAction = (target) => Boolean(target && state.controlFooter?.contains?.(target)
    && !state.controlComposer?.contains?.(target)
    && target.closest?.(CONTROL_NATIVE_SELECTOR));
  const controlOwnerMoved = () => state.controlHost?.hidden || !state.controlAnchorRect
    || !sameControlRect(state.controlFooter?.getBoundingClientRect(), state.controlAnchorRect.footer)
    || !sameControlRect(state.controlAnchor?.getBoundingClientRect(), state.controlAnchorRect.permission);
  const onDocumentPointerDown = (event) => {
    const sessionsSidebar = event.target?.closest?.("aside.app-shell-left-panel");
    if (sessionsSidebar) state.navigationHandler?.();
    else if (!state.controlHost?.contains?.(event.target)
      && ((!state.controlFooter?.contains?.(event.target) && controlOwnerMoved())
        || nativeFooterAction(event.target))) {
      scheduleControlPosition();
    }
    if (!state.menu || state.menu.contains(event.target)
      || state.menuButton?.contains(event.target)) return;
    closeMenu();
  };
