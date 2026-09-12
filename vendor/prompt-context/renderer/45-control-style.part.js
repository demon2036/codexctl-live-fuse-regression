  const installStyle = () => {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      const parent = document.head || document.documentElement;
      if (!parent) return false;
      parent.appendChild(style);
    }
    style.textContent = `
      .cbps-trigger {
        max-width: 230px;
        color: var(--text-secondary, currentColor) !important;
        gap: 4px !important;
      }
      .cbps-control-host {
        position: fixed !important;
        z-index: 40 !important;
        display: flex !important;
        align-items: center !important;
        box-sizing: border-box !important;
        width: max-content;
        max-width: none;
        min-width: 0 !important;
        gap: 4px !important;
        overflow: clip !important;
        pointer-events: none !important;
      }
      .cbps-control-host[data-cbps-measuring="true"] {
        visibility: hidden !important;
        max-width: none !important;
        overflow: visible !important;
      }
      .cbps-control-host[data-cbps-probing="true"] { visibility: hidden !important; }
      .cbps-control-host[data-cbps-probing="true"] * { pointer-events: none !important; }
      .cbps-control-host[hidden] { display: none !important; }
      .cbps-control {
        appearance: none !important;
        -webkit-appearance: none !important;
        box-sizing: border-box !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: flex-start !important;
        flex: 0 0 auto !important;
        min-width: 0 !important;
        max-width: 100% !important;
        height: 28px !important;
        padding: 0 7px !important;
        border: 1px solid transparent !important;
        border-radius: 8px !important;
        background: transparent !important;
        color: var(--ds-text-secondary, var(--text-secondary, #e5e7eb)) !important;
        font-family: inherit !important;
        font-size: 12px !important;
        font-weight: 500 !important;
        line-height: 18px !important;
        letter-spacing: normal !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        pointer-events: auto !important;
      }
      .cbps-control:hover,
      .cbps-control:focus-visible {
        background: color-mix(in srgb, var(--ds-text, #f1f5f7) 10%, transparent) !important;
      }
      .cbps-control:focus-visible {
        outline: 2px solid color-mix(in srgb, var(--ds-cyan, #18d6cf) 70%, transparent) !important;
        outline-offset: 1px;
      }
      .cbps-trigger[data-custom="true"] { color: var(--ds-cyan, #18d6cf) !important; }
      .cbps-context-trigger { max-width: 190px; }
      .cbps-context-trigger[data-context-override="true"] { color: var(--ds-purple, #a78bfa) !important; }
      .cbps-context-trigger[data-runtime-mismatch="true"] { color: var(--ds-yellow, #f2b84b) !important; }
      .cbps-usage-trigger { max-width: 122px; color: var(--ds-green, #74d99f) !important; }
      .cbps-more-trigger { display: none !important; color: var(--ds-text-secondary, #e5e7eb) !important; }
      .cbps-live-trigger { max-width: 138px; color: var(--ds-cyan, #18d6cf) !important; }
      .cbps-live-trigger[data-live-connected="false"] { color: var(--ds-yellow, #f2b84b) !important; }
      .cbps-provider-indicator {
        max-width: 180px;
        cursor: default !important;
        user-select: text !important;
      }
      .cbps-provider-indicator[data-provider-status="resolved"] { color: var(--ds-cyan, #18d6cf) !important; }
      .cbps-provider-indicator[data-provider-selectable="true"] {
        cursor: pointer !important; user-select: none !important;
      }
      .cbps-provider-indicator[data-provider-selectable="true"]:hover,
      .cbps-provider-indicator[data-provider-selectable="true"]:focus-visible {
        outline: none !important;
        color: var(--ds-cyan, #18d6cf) !important;
      }
      .cbps-provider-dot { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 2px; background: currentColor; }
      .cbps-trigger { opacity: 1 !important; visibility: visible !important; pointer-events: auto !important; }
      .cbps-trigger[data-ready="false"] { opacity: .68 !important; }
      .cbps-label { display: inline-flex; align-items: center; min-width: 0; gap: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cbps-label-prefix, .cbps-label-separator { flex: 0 0 auto; opacity: .72; }
      .cbps-label-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cbps-dot { width: 8px; height: 8px; flex: 0 0 auto; border-radius: 999px; background: currentColor; box-shadow: 0 0 0 2px color-mix(in srgb, currentColor 18%, transparent); }
      .cbps-lock-icon { width: 15px; height: 15px; flex: 0 0 auto; }
      .cbps-chevron { width: 14px; height: 14px; flex: 0 0 auto; opacity: .72; }
      .cbps-locked-text { flex: 0 0 auto; opacity: .72; white-space: nowrap; }
      .cbps-menu {
        position: fixed !important;
        z-index: 41 !important;
        box-sizing: border-box !important;
        width: min(500px, calc(100vw - 24px)) !important;
        padding: 10px !important;
        border: 1px solid color-mix(in srgb, var(--ds-cyan, #18d6cf) 35%, rgba(145,155,165,.48)) !important;
        border-radius: 15px !important;
        background: color-mix(in srgb, var(--ds-panel, #151b20) 94%, transparent) !important;
        color: var(--ds-text, #f1f5f7) !important;
        box-shadow: 0 20px 60px rgba(0,0,0,.38), 0 2px 12px rgba(0,0,0,.22) !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
        font-family: inherit !important;
        font-size: 13px !important;
        line-height: 18px !important;
        letter-spacing: normal !important;
        pointer-events: auto !important;
      }
      .cbps-menu-title { padding: 5px 9px 9px; font-size: 14px; line-height: 20px; font-weight: 600; }
      .cbps-menu-subtitle { margin: -5px 9px 9px; color: color-mix(in srgb, currentColor 62%, transparent); font-size: 12px; line-height: 17px; }
      .cbps-live-menu { width: min(480px, calc(100vw - 24px)) !important; max-height: calc(100vh - 24px); overflow-y: auto; }
      .cbps-live-connection { font-variant-numeric: tabular-nums; }
      .cbps-live-master, .cbps-live-plugin {
        display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center;
        gap: 12px; padding: 9px; border-top: 1px solid color-mix(in srgb, currentColor 13%, transparent);
      }
      .cbps-live-master { border-radius: 10px; background: color-mix(in srgb, var(--ds-cyan, #18d6cf) 7%, transparent); }
      .cbps-live-copy { display: grid; min-width: 0; gap: 2px; }
      .cbps-live-copy strong { font-size: 12.5px; line-height: 18px; }
      .cbps-live-copy span { overflow: hidden; color: color-mix(in srgb, currentColor 64%, transparent); font-size: 11px; line-height: 16px; text-overflow: ellipsis; white-space: nowrap; }
      .cbps-live-copy .cbps-live-error { color: #ff9e9e; white-space: normal; }
      .cbps-live-actions { display: flex; align-items: center; gap: 5px; }
      .cbps-live-action {
        min-width: 52px; height: 28px; padding: 0 9px; border: 0; border-radius: 8px;
        background: color-mix(in srgb, var(--ds-cyan, #18d6cf) 20%, transparent); color: inherit;
        cursor: pointer; font-family: inherit; font-size: 11px; font-weight: 600; line-height: 16px;
      }
      .cbps-live-action-secondary { min-width: 28px; background: color-mix(in srgb, currentColor 8%, transparent); }
      .cbps-live-action:disabled { cursor: default; opacity: .42; }
      .cbps-live-pending, .cbps-live-banner-error { margin: 0 9px 8px; padding: 7px 9px; border-radius: 8px; font-size: 11px; }
      .cbps-live-pending { background: color-mix(in srgb, var(--ds-cyan, #18d6cf) 11%, transparent); }
      .cbps-live-banner-error { color: #ffb1b1; background: rgba(255,80,80,.09); }
      .cbps-context-menu { border-color: color-mix(in srgb, var(--ds-purple, #a78bfa) 42%, rgba(145,155,165,.48)) !important; }
      .cbps-usage-menu {
        width: min(460px, calc(100vw - 24px)) !important;
        max-height: calc(100vh - 24px) !important;
        overflow-y: auto !important;
        padding: 6px 10px 7px !important;
        border-color: color-mix(in srgb, var(--ds-green, #74d99f) 42%, rgba(145,155,165,.48)) !important;
      }
      .cbps-usage-title { padding-bottom: 7px; }
      .cbps-usage-section { padding: 5px 9px 6px; border-top: 1px solid color-mix(in srgb, currentColor 13%, transparent); }
      .cbps-usage-heading { display: flex; align-items: center; gap: 7px; margin-bottom: 3px; font-size: 12px; font-weight: 700; letter-spacing: .015em; }
      .cbps-usage-badge { padding: 1px 6px; border-radius: 999px; background: color-mix(in srgb, currentColor 10%, transparent); color: color-mix(in srgb, currentColor 64%, transparent); font-size: 10px; line-height: 16px; font-weight: 650; }
      .cbps-usage-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; min-height: 23px; font-variant-numeric: tabular-nums; }
      .cbps-usage-row-label { min-width: 0; color: color-mix(in srgb, currentColor 72%, transparent); font-size: 12px; }
      .cbps-usage-row-value { color: inherit; font-size: 12px; font-weight: 560; text-align: right; white-space: nowrap; }
      .cbps-usage-progress { position: relative; width: 100%; height: 5px; margin: 3px 0 2px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, currentColor 10%, transparent); }
      .cbps-usage-progress > span { display: block; height: 100%; border-radius: inherit; background: var(--ds-green, #74d99f); }
      .cbps-usage-source-row { grid-template-columns: minmax(0, 1fr) auto; }
      .cbps-usage-source-row .cbps-usage-progress { grid-column: 1 / -1; height: 4px; margin: -1px 0 3px; }
      .cbps-usage-source-row .cbps-usage-progress > span { background: color-mix(in srgb, var(--ds-purple, #a78bfa) 82%, var(--ds-cyan, #18d6cf)); }
      .cbps-usage-note { padding-top: 6px; }
      .cbps-divider { height: 1px; margin: 0 6px 5px; background: color-mix(in srgb, currentColor 16%, transparent); }
      .cbps-menu-item {
        display: grid !important;
        grid-template-columns: 24px minmax(0, .9fr) minmax(0, 1.1fr) !important;
        align-items: center !important;
        width: 100% !important;
        min-height: 40px !important;
        margin: 2px 0 !important;
        padding: 6px 9px !important;
        border: 0 !important;
        border-radius: 10px !important;
        background: transparent !important;
        color: inherit !important;
        text-align: left !important;
        cursor: pointer !important;
        font: inherit !important;
        line-height: 18px !important;
      }
      .cbps-menu-item:hover, .cbps-menu-item:focus-visible, .cbps-menu-item[data-selected="true"] {
        outline: none !important;
        background: color-mix(in srgb, var(--ds-cyan, #18d6cf) 19%, transparent) !important;
      }
      .cbps-check { width: 20px; color: var(--ds-cyan, #18d6cf); font-size: 17px; line-height: 18px; font-weight: 700; text-align: center; }
      .cbps-item-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; line-height: 18px; font-weight: 600; }
      .cbps-item-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: color-mix(in srgb, currentColor 64%, transparent); font-size: 12px; line-height: 17px; }
      .cbps-choose { margin-top: 6px !important; }
      .cbps-custom-divider { margin-top: 8px; }
      .cbps-custom-context { padding: 4px 9px 2px; }
      .cbps-custom-heading { margin-bottom: 7px; color: color-mix(in srgb, currentColor 76%, transparent); font-size: 12px; font-weight: 620; }
      .cbps-custom-fields { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: 8px; align-items: end; }
      .cbps-custom-field { display: grid; gap: 5px; min-width: 0; color: color-mix(in srgb, currentColor 68%, transparent); font-size: 11.5px; line-height: 16px; }
      .cbps-custom-field input {
        box-sizing: border-box; width: 100%; min-width: 0; height: 34px; padding: 0 9px;
        border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: 8px;
        outline: none; background: color-mix(in srgb, currentColor 7%, transparent); color: inherit;
        font: inherit;
        font-size: 13px;
        font-weight: 500;
        line-height: 20px;
      }
      .cbps-custom-field input:focus { border-color: var(--ds-purple, #a78bfa); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ds-purple, #a78bfa) 18%, transparent); }
      .cbps-custom-apply {
        height: 34px; padding: 0 13px; border: 0; border-radius: 8px; cursor: pointer;
        background: color-mix(in srgb, var(--ds-purple, #a78bfa) 28%, transparent); color: inherit;
        font: inherit;
        font-size: 12.5px;
        font-weight: 600;
        line-height: 18px;
      }
      .cbps-custom-apply:hover, .cbps-custom-apply:focus-visible { outline: none; background: color-mix(in srgb, var(--ds-purple, #a78bfa) 40%, transparent); }
      .cbps-note { padding: 9px 10px 3px; color: color-mix(in srgb, currentColor 58%, transparent); font-size: 11.5px; line-height: 16px; }
      .cbps-toast {
        position: fixed !important;
        z-index: 42 !important;
        left: 50% !important;
        bottom: 88px !important;
        max-width: min(520px, calc(100vw - 32px)) !important;
        padding: 10px 14px !important;
        border: 1px solid color-mix(in srgb, var(--ds-cyan, #18d6cf) 32%, rgba(145,155,165,.42)) !important;
        border-radius: 12px !important;
        background: color-mix(in srgb, var(--ds-panel, #151b20) 95%, transparent) !important;
        color: var(--ds-text, #f1f5f7) !important;
        box-shadow: 0 14px 40px rgba(0,0,0,.34) !important;
        transform: translate(-50%, 10px) !important;
        opacity: 0 !important;
        transition: opacity 160ms ease, transform 160ms ease !important;
        pointer-events: none !important;
        font: 500 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      }
      .cbps-toast[data-visible="true"] { opacity: 1 !important; transform: translate(-50%, 0) !important; }
      .cbps-toast[data-kind="error"] { border-color: rgba(255,105,105,.55) !important; }
      .cbps-control-host[data-cbps-density="compact"] .cbps-label-prefix,
      .cbps-control-host[data-cbps-density="compact"] .cbps-label-separator,
      .cbps-control-host[data-cbps-density="tight"] .cbps-label-prefix,
      .cbps-control-host[data-cbps-density="tight"] .cbps-label-separator { display: none; }
      .cbps-control-host[data-cbps-density="compact"] .cbps-locked-text,
      .cbps-control-host[data-cbps-density="tight"] .cbps-locked-text { display: none; }
      .cbps-control-host[data-cbps-density="compact"] .cbps-control { padding-left: 5px !important; padding-right: 5px !important; }
      .cbps-control-host[data-cbps-density="tight"] .cbps-control { gap: 3px !important; padding-left: 4px !important; padding-right: 4px !important; }
      .cbps-control-host[data-cbps-density="tight"] .cbps-label-value { max-width: 72px; }
      .cbps-control-host[data-cbps-density="tight"] .cbps-context-trigger .cbps-label-value { max-width: 64px; }
      .cbps-control-host[data-cbps-density="tight"] .cbps-usage-trigger .cbps-label-value { max-width: 52px; }
      .cbps-control-host[data-cbps-density="tight"] .cbps-provider-indicator .cbps-label-value { max-width: 78px; }
      .cbps-control-host[data-cbps-presentation="overflow"] > [data-codex-base-prompt-trigger="true"],
      .cbps-control-host[data-cbps-presentation="overflow"] > [data-codex-context-window-trigger="true"],
      .cbps-control-host[data-cbps-presentation="overflow"] > [data-codex-context-usage-trigger="true"],
      .cbps-control-host[data-cbps-presentation="overflow"] > [data-codex-provider-indicator="true"],
      .cbps-control-host[data-cbps-presentation="overflow"] > [data-codex-live-control-trigger="true"],
      .cbps-control-host[data-cbps-presentation="more-only"] > [data-codex-base-prompt-trigger="true"],
      .cbps-control-host[data-cbps-presentation="more-only"] > [data-codex-context-window-trigger="true"],
      .cbps-control-host[data-cbps-presentation="more-only"] > [data-codex-context-usage-trigger="true"],
      .cbps-control-host[data-cbps-presentation="more-only"] > [data-codex-provider-indicator="true"],
      .cbps-control-host[data-cbps-presentation="more-only"] > [data-codex-live-control-trigger="true"] {
        display: none !important;
      }
      .cbps-control-host[data-cbps-presentation="overflow"][data-cbps-inline~="base-prompt"] > [data-codex-base-prompt-trigger="true"],
      .cbps-control-host[data-cbps-presentation="overflow"][data-cbps-inline~="context-window"] > .cbps-context-trigger,
      .cbps-control-host[data-cbps-presentation="overflow"][data-cbps-inline~="context-usage"] > .cbps-usage-trigger,
      .cbps-control-host[data-cbps-presentation="overflow"][data-cbps-inline~="provider"] > .cbps-provider-indicator,
      .cbps-control-host[data-cbps-presentation="overflow"][data-cbps-inline~="live-control"] > .cbps-live-trigger {
        display: inline-flex !important;
      }
      .cbps-control-host[data-cbps-presentation="overflow"] .cbps-more-trigger,
      .cbps-control-host[data-cbps-presentation="more-only"] .cbps-more-trigger {
        display: inline-flex !important;
        flex: 0 0 auto !important;
        min-width: 64px !important;
        max-width: 72px !important;
        justify-content: center !important;
      }
      .cbps-control-host[data-cbps-density="tight"] .cbps-more-trigger .cbps-label-prefix { display: inline; }
      .cbps-control-host[data-cbps-density="compact"] .cbps-usage-trigger,
      .cbps-control-host[data-cbps-density="tight"] .cbps-usage-trigger {
        flex: 0 0 auto !important;
        min-width: 92px !important;
        max-width: 104px !important;
      }
      .cbps-control-host[data-cbps-density="compact"] .cbps-usage-trigger .cbps-label-prefix,
      .cbps-control-host[data-cbps-density="tight"] .cbps-usage-trigger .cbps-label-prefix { display: inline; }
      .cbps-control-host[data-cbps-density="compact"] .cbps-usage-trigger .cbps-label-separator,
      .cbps-control-host[data-cbps-density="tight"] .cbps-usage-trigger .cbps-label-separator { display: none; }
      @media (max-width: 760px) {
        .cbps-menu-item { grid-template-columns: 22px minmax(0, 1fr) !important; }
        .cbps-item-path { grid-column: 2; }
        .cbps-custom-fields { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
        .cbps-custom-apply { grid-column: 1 / -1; }
      }
    `;
    return true;
  };
