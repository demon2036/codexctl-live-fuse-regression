export function chooseSidebarScroll(candidates = []) {
  const measurement = (node, field) => {
    const value = Number(node?.[field]);
    return Number.isFinite(value) && value > 0 ? value : 0;
  };
  const overflow = (node) => Math.max(
    0,
    measurement(node, "scrollHeight") - measurement(node, "clientHeight"),
  );
  return [...candidates]
    .filter(Boolean)
    .sort((left, right) => {
      const leftOverflow = overflow(left);
      const rightOverflow = overflow(right);
      const overflowingDelta = Number(rightOverflow > 1) - Number(leftOverflow > 1);
      if (overflowingDelta) return overflowingDelta;
      if (rightOverflow > 1 && rightOverflow !== leftOverflow) {
        return rightOverflow - leftOverflow;
      }
      return measurement(right, "clientHeight") - measurement(left, "clientHeight");
    })[0] ?? null;
}
