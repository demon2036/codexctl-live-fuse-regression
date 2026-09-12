// Runs inside the owned renderer. Layout wrappers are never editable targets.
export function benchmarkTargets(chooseSidebarScroll) {
  const visible = (node) => {
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 1 && rect.height > 1 && style.visibility !== "hidden"
      && style.display !== "none";
  };
  const editors = [...document.querySelectorAll(
    'textarea, [contenteditable="true"], [role="textbox"]',
  )].filter(visible);
  const composer = editors.find((node) => node.matches('[data-codex-composer="true"]'))
    ?? editors.find((node) => node.closest('[data-composer-layout], .composer-surface-chrome'))
    ?? editors[0] ?? null;
  const aside = document.querySelector('aside.app-shell-left-panel');
  const scrollables = [aside, ...(aside?.querySelectorAll('*') ?? [])].filter((node) =>
    visible(node) && /(auto|scroll)/.test(getComputedStyle(node).overflowY));
  return { composer, sidebar: chooseSidebarScroll(scrollables) };
}
