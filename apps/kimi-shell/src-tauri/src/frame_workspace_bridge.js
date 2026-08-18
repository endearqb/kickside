(function () {
  const CHAT_BRIDGE_SOURCE = "kimi-shell-chat-external-link-bridge";
  const EXTERNAL_BRIDGE_SOURCE = "kimi-shell-external-link-bridge";
  const THEME_SYNC_SOURCE = "kimi-shell-theme-sync";
  const KIMI_COLOR_SCHEME_KEY = "kimi-web.color-scheme";
  const LEGACY_THEME_KEY = "kimi-theme";
  const SESSION_SYNC_SOURCE = "kimi-shell-session-sync";
  const SESSION_BRIDGE_SOURCE = "kimi-shell-session-bridge";
  const DSH_WORKSPACE_SYNC_SOURCE = "kimi-shell-dsh-workspace-sync";
  const DSH_WORKSPACE_BRIDGE_SOURCE = "kimi-shell-dsh-workspace-bridge";
  const NATIVE_FILE_DROP_SOURCE = "kimi-shell-native-file-drop";
  const DSH_SESSION_STORAGE_KEY = "dsh.sessions.current";
  const CHAT_ORIGIN = "https://www.kimi.com";
  const KIMI_BROWSER_ORIGIN = "https://www.kimi.com";
  const KIMI_CODE_ACCOUNT_ROUTE_PATTERN =
    /^\/(?:login(?:\/|$)|auth(?:\/|$)|oauth(?:\/|$)|membership(?:\/|$)|subscription(?:\/|$))/i;
  const MAX_SESSION_ID_LENGTH = 512;
  const MAX_DSH_WORK_DIR_LENGTH = 32768;
  const THEME_STYLE_ID = "kimi-sidekick-pane-theme";
  const KIMI_LAYOUT_STYLE_ID = "kickside-kimi-layout-v2";
  const KIMI_LAYOUT_STORAGE_KEY = "kimi-web-layout-v2";
  const KIMI_LAYOUT_ATTR = "data-kimi-shell-layout";
  const KIMI_LAYOUT_WIDE_MIN = 1180;
  const KIMI_LAYOUT_COMPACT_MIN = 960;
  const THEME_PALETTES = {
    light: {
      background: "#ffffff",
      color: "#24292f",
      themeColor: "#ffffff",
    },
    dark: {
      background: "#121212",
      color: "rgba(255, 255, 255, 0.84)",
      themeColor: "#121212",
    },
  };

  function ensureMeta(name, content) {
    if (!document.head) {
      return;
    }
    let meta = document.head.querySelector('meta[name="' + name + '"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", name);
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", content);
  }

  function applyPaneTheme(theme) {
    const palette = THEME_PALETTES[theme];
    if (!palette) {
      return;
    }

    try {
      localStorage.setItem(KIMI_COLOR_SCHEME_KEY, theme);
      localStorage.setItem(LEGACY_THEME_KEY, theme);
    } catch (_) {
      // Storage can be unavailable for sandboxed or privacy-restricted frames.
    }

    document.documentElement.dataset.colorScheme = theme;
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
    document.documentElement.dataset.kimiSidekickTheme = theme;
    if (document.body) {
      document.body.dataset.kimiSidekickTheme = theme;
      document.body.toggleAttribute("data-ds-dark-theme", theme === "dark");
    }
    ensureMeta("color-scheme", theme);
    ensureMeta("theme-color", palette.themeColor);

    if (!document.head) {
      return;
    }
    let style = document.getElementById(THEME_STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = THEME_STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent =
      ":root { color-scheme: " +
      theme +
      "; }\nhtml, body { background-color: " +
      palette.background +
      "; color: " +
      palette.color +
      "; }\n";
  }

  let kimiLayoutRequested = false;
  let kimiLayoutHostAccent = "";
  let kimiLayoutInitialized = false;
  let kimiLayoutRefreshPending = false;
  let kimiLayoutObserver = null;
  let kimiLayoutMutationObserver = null;
  let kimiLayoutProjectionSignature = "";
  let kimiLayoutMissingContractWarned = false;
  let kimiFileDropCompatInitialized = false;
  let kimiNativeFileDropNonce = "";

  function attachNativeDroppedFiles(data) {
    if (
      !kimiLayoutRequested ||
      !kimiNativeFileDropNonce ||
      data.bridgeNonce !== kimiNativeFileDropNonce ||
      !Array.isArray(data.files) ||
      data.files.length === 0 ||
      data.files.length > 8
    ) {
      return;
    }
    const input = document.querySelector(
      'input[type="file"].file-input-hidden,input[type="file"][multiple]',
    );
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    try {
      const transfer = new DataTransfer();
      for (const item of data.files) {
        if (
          !item ||
          typeof item.name !== "string" ||
          typeof item.type !== "string" ||
          !(item.bytes instanceof ArrayBuffer) ||
          item.bytes.byteLength !== item.size
        ) {
          return;
        }
        transfer.items.add(
          new File([item.bytes], item.name, {
            type: item.type,
            lastModified: Date.now(),
          }),
        );
      }
      input.value = "";
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (_) {
      // Kimi owns upload validation and user-facing error handling.
    }
  }

  function hasProtectedWebKitFileDrag(event) {
    const transfer = event && event.dataTransfer;
    if (!transfer) {
      return false;
    }

    const hasFilesType = Array.from(transfer.types || []).some(
      (type) => String(type) === "Files",
    );
    const hasVisibleFileItem = Array.from(transfer.items || []).some(
      (item) => item && item.kind === "file",
    );
    return hasFilesType && !hasVisibleFileItem;
  }

  function initializeKimiFileDropCompat() {
    if (kimiFileDropCompatInitialized || window.top === window) {
      return;
    }
    kimiFileDropCompatInitialized = true;

    function allowProtectedWebKitFileDrop(event) {
      if (hasProtectedWebKitFileDrag(event)) {
        // Finder file metadata is protected during dragover in WKWebView. Kimi
        // already falls back to dataTransfer.files on drop; cancelling these
        // phases only tells WebKit to deliver that drop to Kimi's own handler.
        event.preventDefault();
      }
    }

    document.addEventListener("dragenter", allowProtectedWebKitFileDrop, true);
    document.addEventListener("dragover", allowProtectedWebKitFileDrop, true);
    window.addEventListener(
      "pagehide",
      function () {
        document.removeEventListener("dragenter", allowProtectedWebKitFileDrop, true);
        document.removeEventListener("dragover", allowProtectedWebKitFileDrop, true);
      },
      { once: true },
    );
  }

  function isKimiLayoutEnabledByUser() {
    try {
      return localStorage.getItem(KIMI_LAYOUT_STORAGE_KEY) !== "off";
    } catch (_) {
      return true;
    }
  }

  function normalizeCssColor(value) {
    if (typeof value !== "string") {
      return "";
    }
    const color = value.trim();
    if (!color) {
      return "";
    }
    try {
      return window.CSS && window.CSS.supports("color", color) ? color : "";
    } catch (_) {
      return "";
    }
  }

  function resolveKimiAccent() {
    try {
      const styles = window.getComputedStyle(document.documentElement);
      for (const name of ["--logo", "--blue", "--sidebar-accent", "--color-primary"]) {
        const value = normalizeCssColor(styles.getPropertyValue(name));
        if (value) {
          return value;
        }
      }
    } catch (_) {
      // Fall through to the host color and the Kimi blue compatibility value.
    }
    return normalizeCssColor(kimiLayoutHostAccent) || "#1783ff";
  }

  function applyKimiAccent() {
    document.documentElement.style.setProperty(
      "--kimi-enhanced-accent",
      resolveKimiAccent(),
      "important",
    );
  }

  function kimiViewportWidth() {
    return Math.round(
      (document.documentElement && document.documentElement.clientWidth) ||
        window.innerWidth ||
        0,
    );
  }

  function setKimiLayoutMode() {
    const width = kimiViewportWidth();
    const mode =
      width >= KIMI_LAYOUT_WIDE_MIN
        ? "wide"
        : width >= KIMI_LAYOUT_COMPACT_MIN
          ? "compact"
          : "narrow";
    const root = document.documentElement;
    root.setAttribute(KIMI_LAYOUT_ATTR, mode);
    root.style.setProperty("--kimi-shell-viewport-width", width + "px");
    scheduleKimiLayoutRefresh();
  }

  function findKimiHeader() {
    const desktop = document.querySelector("header.chat-header");
    if (desktop instanceof HTMLElement) {
      return desktop;
    }
    const switcher = document.querySelector(
      'button[aria-label="切换会话 / 工作区"],button[aria-label="Switch session / workspace"]',
    );
    const mobile = switcher && switcher.closest(".topbar");
    return mobile instanceof HTMLElement ? mobile : null;
  }

  function findKimiComposer() {
    const input = document.querySelector(
      'textarea[placeholder*="消息"],textarea[placeholder*="message" i],textarea[role="combobox"]',
    );
    if (!(input instanceof HTMLElement)) {
      return null;
    }
    const explicit = input.closest(".composer");
    if (explicit instanceof HTMLElement) {
      return explicit;
    }
    const form = input.closest("form");
    return form instanceof HTMLElement ? form : null;
  }

  function findKimiSessionSidebar() {
    const explicit = document.querySelector("aside.side");
    if (explicit instanceof HTMLElement) {
      return explicit;
    }
    const toggle = document.querySelector(
      'button[aria-label="收起侧边栏"],button[aria-label="展开侧边栏"],' +
        'button[aria-label="关闭会话侧栏"],button[aria-label="打开会话侧栏"],' +
        'button[aria-label="Close sidebar"],button[aria-label="Open sidebar"],' +
        'button[aria-label="Close sessions sidebar"],button[aria-label="Open sessions sidebar"]',
    );
    const fallback = toggle && toggle.closest("aside");
    return fallback instanceof HTMLElement ? fallback : null;
  }

  function isKimiConversationOutline(element) {
    if (
      !(element instanceof HTMLElement) ||
      element.matches("aside.side") ||
      element.dataset.kimiEnhancedOutlineProjection === "true"
    ) {
      return false;
    }
    const scroll = element.querySelector(":scope > .toc-scroll");
    return Boolean(
      element.matches("nav.conversation-toc") &&
        scroll &&
        scroll.querySelector("button.toc-row > .toc-bar + .toc-label"),
    );
  }

  function findNativeKimiConversationOutline() {
    const candidates = document.querySelectorAll(
      'nav.conversation-toc[aria-label="对话目录"],' +
        'nav.conversation-toc[aria-label="Conversation outline"],' +
        "section.con > nav.conversation-toc",
    );
    for (const candidate of candidates) {
      if (isKimiConversationOutline(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  function normalizedKimiTurnLabel(anchor) {
    const source =
      anchor.querySelector(".u-bub,[data-role='user-message'],[data-message-role='user']") ||
      anchor;
    const value = (source.textContent || "").replace(/\s+/g, " ").trim();
    return value ? value.slice(0, 96) : "消息";
  }

  function kimiTurnAnchors() {
    const seen = new Set();
    return Array.from(document.querySelectorAll(".u-bub.turn-anchor[data-turn-id]"))
      .filter(function (anchor) {
        if (!(anchor instanceof HTMLElement)) {
          return false;
        }
        const turnId = anchor.dataset.turnId;
        if (!turnId || seen.has(turnId)) {
          return false;
        }
        seen.add(turnId);
        return true;
      });
  }

  function removeKimiOutlineProjection(nextOutline) {
    const projections = document.querySelectorAll(
      '[data-kimi-enhanced-outline-projection="true"]',
    );
    if (projections.length) {
      const projectionHadFocus = Array.from(projections).some(function (node) {
        return node instanceof HTMLElement && node.contains(document.activeElement);
      });
      projections.forEach(function (node) {
        node.remove();
      });
      if (projectionHadFocus && nextOutline instanceof HTMLElement) {
        window.requestAnimationFrame(function () {
          const target = nextOutline.querySelector("button.toc-row");
          target instanceof HTMLElement && target.focus({ preventScroll: true });
        });
      }
    }
    kimiLayoutProjectionSignature = "";
  }

  function ensureKimiOutlineProjection() {
    if (findKimiSessionSidebar() instanceof HTMLElement) {
      removeKimiOutlineProjection();
      return null;
    }
    const anchors = kimiTurnAnchors();
    if (anchors.length < 2) {
      removeKimiOutlineProjection();
      return null;
    }
    let outline = document.querySelector('[data-kimi-enhanced-outline-projection="true"]');
    let projectionCreated = false;
    if (!(outline instanceof HTMLElement)) {
      outline = document.createElement("nav");
      outline.className = "conversation-toc kimi-shell-outline-projection";
      outline.dataset.kimiEnhancedOutlineProjection = "true";
      outline.setAttribute("aria-label", "对话目录");
      const scroll = document.createElement("div");
      scroll.className = "toc-scroll";
      outline.appendChild(scroll);
      (document.body || document.documentElement).appendChild(outline);
      projectionCreated = true;
    }
    const signature = anchors
      .map(function (anchor) {
        return anchor.dataset.turnId + "\n" + normalizedKimiTurnLabel(anchor);
      })
      .join("\n---\n");
    if (projectionCreated || signature !== kimiLayoutProjectionSignature) {
      const scroll = outline.querySelector(":scope > .toc-scroll");
      if (scroll instanceof HTMLElement) {
        scroll.replaceChildren();
        anchors.forEach(function (anchor, index) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = index === 0 ? "toc-row active" : "toc-row";
          button.dataset.turnId = anchor.dataset.turnId || "";
          button.setAttribute("aria-label", normalizedKimiTurnLabel(anchor));
          const bar = document.createElement("span");
          bar.className = "toc-bar";
          const label = document.createElement("span");
          label.className = "toc-label";
          label.textContent = normalizedKimiTurnLabel(anchor);
          button.append(bar, label);
          button.addEventListener("click", function () {
            const target = kimiTurnAnchors().find(function (candidate) {
              return candidate.dataset.turnId === button.dataset.turnId;
            });
            target && target.scrollIntoView({ behavior: "auto", block: "center" });
            outline.querySelectorAll("button.toc-row.active").forEach(function (row) {
              row.classList.remove("active");
            });
            button.classList.add("active");
          });
          scroll.appendChild(button);
        });
      }
      kimiLayoutProjectionSignature = signature;
    }
    return outline;
  }

  function findKimiConversationOutline() {
    const nativeOutline = findNativeKimiConversationOutline();
    if (nativeOutline) {
      removeKimiOutlineProjection(nativeOutline);
      return nativeOutline;
    }
    return ensureKimiOutlineProjection();
  }

  function findKimiWorkspaceIcon(header) {
    const explicit = header && header.querySelector(".wsq");
    if (explicit instanceof HTMLElement) {
      return explicit;
    }
    return null;
  }

  function ensureKimiLayoutStyle() {
    if (!document.head || document.getElementById(KIMI_LAYOUT_STYLE_ID)) {
      return;
    }
    const style = document.createElement("style");
    style.id = KIMI_LAYOUT_STYLE_ID;
    style.textContent = `
:root {
  --kimi-enhanced-composer-bottom-gap: 12px;
  --kimi-enhanced-accent: #1783ff;
  --kimi-outline-glass-background: rgb(255 255 255 / 58%);
  --kimi-outline-glass-border: rgb(31 31 31 / 10%);
  --kimi-outline-glass-shadow: 0 8px 24px rgb(31 31 31 / 12%);
}
:root.dark {
  --kimi-outline-glass-background: rgb(28 29 31 / 58%);
  --kimi-outline-glass-border: rgb(255 255 255 / 12%);
  --kimi-outline-glass-shadow: 0 8px 28px rgb(0 0 0 / 28%);
}
[data-kimi-enhanced-composer="true"] {
  box-sizing: border-box !important;
  padding-bottom: calc(
    var(--kimi-enhanced-composer-bottom-gap) + env(safe-area-inset-bottom, 0px)
  ) !important;
}
[data-kimi-enhanced-workspace-icon="true"] {
  background: var(--kimi-enhanced-accent) !important;
  border-color: transparent !important;
  color: #fff !important;
}
[data-kimi-enhanced-conversation-outline="true"] {
  --kimi-outline-inline: 100cqi;
  --kimi-outline-content-max: min(
    var(--p-content-max, 760px),
    calc(var(--kimi-outline-inline) - 40px)
  );
  --kimi-outline-rail-left: max(
    calc(env(safe-area-inset-left, 0px) + 8px),
    calc(50% - (var(--kimi-outline-content-max) / 2) - 27px)
  );
  --kimi-outline-expanded-panel-width: min(
    220px,
    calc(var(--kimi-outline-inline) - var(--kimi-outline-rail-left) - 8px)
  );
  bottom: auto !important;
  display: flex !important;
  flex-direction: column !important;
  justify-content: center !important;
  left: var(--kimi-outline-rail-left) !important;
  max-height: calc(100% - 160px) !important;
  max-width: calc(
    var(--kimi-outline-inline) - var(--kimi-outline-rail-left) - 8px
  ) !important;
  overflow: visible !important;
  opacity: 0.5 !important;
  pointer-events: none !important;
  position: absolute !important;
  right: auto !important;
  top: 50% !important;
  transform: translateY(-50%) !important;
  visibility: visible !important;
  width: max-content !important;
  z-index: var(--z-sticky, 100) !important;
}
[data-kimi-enhanced-outline-projection="true"] {
  --kimi-outline-inline: 100vw;
  --kimi-outline-rail-left: max(
    calc(env(safe-area-inset-left, 0px) + 8px),
    calc(50vw - (var(--kimi-outline-content-max) / 2) - 27px)
  );
  max-height: calc(100dvh - 160px) !important;
  position: fixed !important;
}
[data-kimi-enhanced-conversation-outline="true"]::before {
  content: "" !important;
  inset: -2px auto -2px -2px !important;
  pointer-events: auto !important;
  position: absolute !important;
  width: 7px !important;
  z-index: 0 !important;
}
[data-kimi-enhanced-conversation-outline="true"]::after {
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
  background: var(--kimi-outline-glass-background) !important;
  border: 1px solid var(--kimi-outline-glass-border) !important;
  border-radius: 12px !important;
  box-shadow: var(--kimi-outline-glass-shadow) !important;
  content: "" !important;
  box-sizing: border-box !important;
  inset-block: -10px !important;
  inset-inline: -14px auto !important;
  opacity: 0 !important;
  pointer-events: none !important;
  position: absolute !important;
  transform: scale(0.98) !important;
  transform-origin: left center !important;
  transition: opacity 120ms, transform 120ms !important;
  visibility: hidden !important;
  width: var(--kimi-outline-expanded-panel-width) !important;
  z-index: 0 !important;
}
[data-kimi-enhanced-conversation-outline="true"] .toc-scroll {
  display: flex !important;
  flex-direction: column !important;
  gap: 7px !important;
  min-height: 0 !important;
  overflow-y: auto !important;
  padding: 8px 0 !important;
  pointer-events: none !important;
  position: relative !important;
  scrollbar-width: none !important;
  z-index: 1 !important;
}
[data-kimi-enhanced-conversation-outline="true"] .toc-row {
  align-items: center !important;
  background: transparent !important;
  border: 0 !important;
  color: inherit !important;
  cursor: pointer !important;
  display: flex !important;
  flex-direction: row !important;
  gap: 10px !important;
  height: 18px !important;
  font: inherit !important;
  padding: 0 !important;
  pointer-events: auto !important;
  text-align: left !important;
  user-select: none !important;
  white-space: nowrap !important;
}
[data-kimi-enhanced-conversation-outline="true"] .toc-bar {
  background: var(--color-accent, var(--kimi-enhanced-accent)) !important;
  border-radius: 9999px !important;
  flex: none !important;
  height: 14px !important;
  opacity: 0.3 !important;
  transition: opacity 120ms, height 120ms !important;
  width: 3px !important;
}
[data-kimi-enhanced-conversation-outline="true"] .toc-row.active .toc-bar {
  height: 18px !important;
  opacity: 1 !important;
}
[data-kimi-enhanced-conversation-outline="true"] .toc-label {
  display: block !important;
  max-width: 0 !important;
  opacity: 0 !important;
  overflow: hidden !important;
  text-align: left !important;
  text-overflow: ellipsis !important;
  transition: max-width 220ms, opacity 120ms !important;
}
[data-kimi-enhanced-conversation-outline="true"]:hover,
[data-kimi-enhanced-conversation-outline="true"]:focus-within {
  opacity: 1 !important;
}
[data-kimi-enhanced-conversation-outline="true"]:hover::after,
[data-kimi-enhanced-conversation-outline="true"]:focus-within::after {
  -webkit-backdrop-filter: blur(18px) saturate(140%) !important;
  backdrop-filter: blur(18px) saturate(140%) !important;
  opacity: 1 !important;
  transform: scale(1) !important;
  visibility: visible !important;
}
[data-kimi-enhanced-conversation-outline="true"]:hover .toc-label,
[data-kimi-enhanced-conversation-outline="true"]:focus-within .toc-label {
  max-width: max(
    0px,
    calc(var(--kimi-outline-expanded-panel-width) - 41px)
  ) !important;
  opacity: 1 !important;
  width: max(
    0px,
    calc(var(--kimi-outline-expanded-panel-width) - 41px)
  ) !important;
}
@media (prefers-reduced-motion: reduce) {
  [data-kimi-enhanced-conversation-outline="true"]::after {
    transition: none !important;
  }
}
`;
    document.head.appendChild(style);
  }

  function clearKimiMarker(selector, dataName) {
    document.querySelectorAll(selector).forEach(function (node) {
      if (node instanceof HTMLElement) {
        delete node.dataset[dataName];
      }
    });
  }

  function clearKimiOutlineMarker() {
    document
      .querySelectorAll('[data-kimi-enhanced-conversation-outline="true"]')
      .forEach(function (node) {
        if (!(node instanceof HTMLElement)) {
          return;
        }
        const previousAriaHidden = node.dataset.kimiEnhancedOriginalAriaHidden;
        const previousInert = node.dataset.kimiEnhancedOriginalInert;
        if (previousAriaHidden === "__missing__") {
          node.removeAttribute("aria-hidden");
        } else if (typeof previousAriaHidden === "string") {
          node.setAttribute("aria-hidden", previousAriaHidden);
        }
        delete node.dataset.kimiEnhancedOriginalAriaHidden;
        if (previousInert === "true") {
          node.setAttribute("inert", "");
        } else {
          node.removeAttribute("inert");
        }
        delete node.dataset.kimiEnhancedOriginalInert;
        node.style.removeProperty("--kimi-outline-rail-left");
        delete node.dataset.kimiEnhancedConversationOutline;
        if (node.dataset.kimiEnhancedGeneratedId === "true") {
          node.removeAttribute("id");
          delete node.dataset.kimiEnhancedGeneratedId;
        }
      });
  }

  function markKimiLayoutNodes() {
    const header = findKimiHeader();
    const composer = findKimiComposer();
    const sidebar = findKimiSessionSidebar();
    const mode = document.documentElement.getAttribute(KIMI_LAYOUT_ATTR);
    const compactSurface = mode !== "wide" && !(sidebar instanceof HTMLElement);
    const outline = findKimiConversationOutline();
    clearKimiMarker('[data-kimi-enhanced-composer="true"]', "kimiEnhancedComposer");
    clearKimiMarker('[data-kimi-enhanced-workspace-icon="true"]', "kimiEnhancedWorkspaceIcon");
    clearKimiOutlineMarker();
    if (compactSurface && composer) {
      composer.dataset.kimiEnhancedComposer = "true";
    }
    const icon = findKimiWorkspaceIcon(header);
    if (compactSurface && icon) {
      icon.dataset.kimiEnhancedWorkspaceIcon = "true";
    }
    const enhanceOutline = Boolean(outline);
    if (enhanceOutline && outline) {
      outline.style.removeProperty("--kimi-outline-rail-left");
      if (sidebar instanceof HTMLElement) {
        outline.style.setProperty("--kimi-outline-rail-left", "5px");
      }
      outline.dataset.kimiEnhancedOriginalAriaHidden =
        outline.getAttribute("aria-hidden") === null
          ? "__missing__"
          : outline.getAttribute("aria-hidden") || "";
      outline.dataset.kimiEnhancedOriginalInert = outline.hasAttribute("inert")
        ? "true"
        : "false";
      outline.dataset.kimiEnhancedConversationOutline = "true";
      outline.removeAttribute("inert");
      outline.removeAttribute("aria-hidden");
    }
    applyKimiAccent();
    return Boolean((header && composer) || enhanceOutline);
  }

  function refreshKimiLayout() {
    kimiLayoutRefreshPending = false;
    if (typeof document === "undefined" || !document.documentElement) {
      kimiLayoutObserver && kimiLayoutObserver.disconnect();
      kimiLayoutMutationObserver && kimiLayoutMutationObserver.disconnect();
      return;
    }
    markKimiLayoutNodes();
  }

  function scheduleKimiLayoutRefresh() {
    if (!kimiLayoutInitialized || kimiLayoutRefreshPending) {
      return;
    }
    kimiLayoutRefreshPending = true;
    window.requestAnimationFrame(refreshKimiLayout);
  }

  function initializeKimiLayout() {
    if (
      kimiLayoutInitialized ||
      !kimiLayoutRequested ||
      !isKimiLayoutEnabledByUser() ||
      window.top === window
    ) {
      return;
    }
    kimiLayoutInitialized = true;
    ensureKimiLayoutStyle();
    setKimiLayoutMode();
    markKimiLayoutNodes();

    if (typeof ResizeObserver === "function") {
      kimiLayoutObserver = new ResizeObserver(setKimiLayoutMode);
      kimiLayoutObserver.observe(document.documentElement);
    } else {
      window.addEventListener("resize", setKimiLayoutMode, { passive: true });
    }

    if (typeof MutationObserver === "function") {
      kimiLayoutMutationObserver = new MutationObserver(scheduleKimiLayoutRefresh);
      kimiLayoutMutationObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }

    window.addEventListener(
      "pagehide",
      function () {
        kimiLayoutObserver && kimiLayoutObserver.disconnect();
        kimiLayoutMutationObserver && kimiLayoutMutationObserver.disconnect();
      },
      { once: true },
    );

    window.setTimeout(function () {
      if (typeof document === "undefined" || !document.documentElement) {
        return;
      }
      if (!markKimiLayoutNodes() && !kimiLayoutMissingContractWarned) {
        kimiLayoutMissingContractWarned = true;
        console.warn(
          "[KickSide] Kimi Web layout enhancement skipped: required semantic hooks were not found.",
        );
      }
    }, 1500);
  }

  window.addEventListener("message", function (event) {
    const data = event && event.data;
    if (!data) {
      return;
    }
    if (data.source === THEME_SYNC_SOURCE) {
      applyPaneTheme(data.theme);
      if (
        event.source === window.parent &&
        data.surface === "kimi-code" &&
        data.layoutEnhancement === "v2"
      ) {
        kimiLayoutRequested = true;
        kimiNativeFileDropNonce =
          typeof data.bridgeNonce === "string" ? data.bridgeNonce : "";
        kimiLayoutHostAccent = typeof data.accent === "string" ? data.accent : "";
        initializeKimiFileDropCompat();
        initializeKimiLayout();
        if (kimiLayoutInitialized) {
          applyKimiAccent();
        }
      }
      return;
    }
    if (
      data.source === NATIVE_FILE_DROP_SOURCE &&
      data.action === "attach_files" &&
      event.source === window.parent
    ) {
      attachNativeDroppedFiles(data);
      return;
    }
    if (
      data.source === SESSION_SYNC_SOURCE &&
      data.action === "report_current_session" &&
      event.source === window.parent
    ) {
      postCurrentSession("current_session_response", data.requestId, "requested");
      return;
    }
    if (
      data.source === DSH_WORKSPACE_SYNC_SOURCE &&
      data.action === "report_current_workspace" &&
      event.source === window.parent
    ) {
      reportDshWorkspace("current_workspace_response", data.requestId, "requested");
    }
  });

  if (window.top === window) {
    return;
  }

  let FRAME_ORIGIN = "";
  try {
    FRAME_ORIGIN = window.location.origin;
  } catch (_) {
    return;
  }

  function resolveUrl(rawUrl) {
    if (!rawUrl) {
      return null;
    }
    try {
      return new URL(String(rawUrl), window.location.href);
    } catch (_) {
      return null;
    }
  }

  function normalizeSessionId(value) {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    return trimmed && trimmed.length <= MAX_SESSION_ID_LENGTH ? trimmed : null;
  }

  function currentSessionId() {
    try {
      const match = window.location.pathname.match(/^\/sessions\/([^/]+)\/?$/);
      if (match && match[1]) {
        return normalizeSessionId(decodeURIComponent(match[1]));
      }
      return normalizeSessionId(new URLSearchParams(window.location.search).get("session"));
    } catch (_) {
      return null;
    }
  }

  function postCurrentSession(action, requestId, reason) {
    try {
      if (!window.parent || window.parent === window) {
        return;
      }
      const sessionId = currentSessionId();
      window.parent.postMessage(
        {
          source: SESSION_BRIDGE_SOURCE,
          action: action,
          requestId: typeof requestId === "string" ? requestId : "",
          sessionId: sessionId,
          applied: Boolean(sessionId),
          reason: sessionId ? reason : "no_active_session",
        },
        "*",
      );
    } catch (_) {
      // ignore
    }
  }

  let lastReportedSessionId;
  function reportSessionChange(reason) {
    const sessionId = currentSessionId();
    if (sessionId === lastReportedSessionId) {
      return;
    }
    lastReportedSessionId = sessionId;
    postCurrentSession("pane_session_changed", "", reason);
  }

  ["pushState", "replaceState"].forEach(function (methodName) {
    try {
      const nativeMethod = window.history[methodName];
      if (typeof nativeMethod !== "function") {
        return;
      }
      window.history[methodName] = function () {
        const result = nativeMethod.apply(this, arguments);
        reportSessionChange("history_" + methodName);
        return result;
      };
    } catch (_) {
      // ignore
    }
  });
  window.addEventListener("popstate", function () {
    reportSessionChange("popstate");
  });
  setTimeout(function () {
    reportSessionChange("initial");
  }, 0);

  let dshSelection = null;
  let dshWorkspaceGeneration = 0;
  let lastDshWorkspaceSignature;

  function parseDshSelection(rawValue) {
    if (typeof rawValue !== "string" || !rawValue.trim()) {
      return null;
    }
    try {
      const value = JSON.parse(rawValue);
      if (!value || typeof value !== "object") {
        return null;
      }
      const sessionId = normalizeSessionId(value.sessionId);
      if (!sessionId) {
        return null;
      }
      const parentSessionId = normalizeSessionId(value.subagentAddress && value.subagentAddress.parentSessionId);
      return { sessionId: sessionId, parentSessionId: parentSessionId };
    } catch (_) {
      return null;
    }
  }

  function nextDshRpcId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID();
      }
      if (window.crypto && typeof window.crypto.getRandomValues === "function") {
        const bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        return Array.from(bytes, function (byte) {
          return byte.toString(16).padStart(2, "0");
        }).join("");
      }
    } catch (_) {
      // Fall through to a non-secret request correlation id.
    }
    return "kickside-dsh-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  }

  function normalizeDshWorkDir(value) {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    return trimmed && trimmed.length <= MAX_DSH_WORK_DIR_LENGTH ? trimmed : null;
  }

  async function resolveDshWorkDir(selection) {
    if (!selection || typeof window.fetch !== "function") {
      return null;
    }
    const rpcId = nextDshRpcId();
    const response = await window.fetch("/api/session.list", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "client-request",
        rpcId: rpcId,
        method: "session.list",
        payload: {},
      }),
    });
    if (!response || !response.ok) {
      return null;
    }
    const envelope = await response.json();
    if (
      !envelope ||
      envelope.type !== "server-response" ||
      envelope.rpcId !== rpcId ||
      !envelope.result ||
      envelope.result.ok !== true ||
      !envelope.result.value ||
      !Array.isArray(envelope.result.value.items)
    ) {
      return null;
    }
    const candidates = [selection.sessionId, selection.parentSessionId].filter(Boolean);
    for (const sessionId of candidates) {
      const row = envelope.result.value.items.find(function (item) {
        return item && item.sessionId === sessionId;
      });
      const workDir = normalizeDshWorkDir(row && row.cwd);
      if (workDir) {
        return workDir;
      }
    }
    return null;
  }

  function postDshWorkspace(action, requestId, reason, selection, workDir) {
    try {
      if (!window.parent || window.parent === window) {
        return;
      }
      window.parent.postMessage(
        {
          source: DSH_WORKSPACE_BRIDGE_SOURCE,
          action: action,
          requestId: typeof requestId === "string" ? requestId : "",
          sessionId: selection ? selection.sessionId : null,
          workDir: workDir,
          applied: Boolean(selection && workDir),
          reason: reason,
        },
        "*",
      );
    } catch (_) {
      // ignore
    }
  }

  function reportDshWorkspace(action, requestId, reason) {
    const selection = dshSelection;
    const generation = ++dshWorkspaceGeneration;
    if (!selection) {
      const signature = "none";
      if (action === "dsh_workspace_changed" && signature === lastDshWorkspaceSignature) {
        return;
      }
      lastDshWorkspaceSignature = signature;
      postDshWorkspace(action, requestId, reason, null, null);
      return;
    }
    void resolveDshWorkDir(selection)
      .then(function (workDir) {
        if (generation !== dshWorkspaceGeneration) {
          return;
        }
        const signature = selection.sessionId + "\n" + (workDir || "");
        if (action === "dsh_workspace_changed" && signature === lastDshWorkspaceSignature) {
          return;
        }
        lastDshWorkspaceSignature = signature;
        postDshWorkspace(action, requestId, reason, selection, workDir);
      })
      .catch(function () {
        if (generation === dshWorkspaceGeneration) {
          postDshWorkspace(action, requestId, "session_list_failed", selection, null);
        }
      });
  }

  function observeDshSelection(rawValue, reason) {
    dshSelection = parseDshSelection(rawValue);
    reportDshWorkspace("dsh_workspace_changed", "", reason);
  }

  function installDshSelectionObserver() {
    try {
      const storagePrototype = window.Storage && window.Storage.prototype;
      if (storagePrototype && !storagePrototype.__kicksideDshSelectionObserver) {
        const nativeSetItem = storagePrototype.setItem;
        Object.defineProperty(storagePrototype, "__kicksideDshSelectionObserver", {
          value: true,
          configurable: false,
        });
        storagePrototype.setItem = function (key, value) {
          const result = nativeSetItem.apply(this, arguments);
          try {
            if (this === window.localStorage && key === DSH_SESSION_STORAGE_KEY) {
              observeDshSelection(String(value), "selection_persisted");
            }
          } catch (_) {
            // ignore
          }
          return result;
        };
      }
    } catch (_) {
      // Storage may be unavailable in privacy-restricted frames.
    }

    setTimeout(function () {
      try {
        const raw = window.localStorage.getItem(DSH_SESSION_STORAGE_KEY);
        if (raw !== null || window.__DSH_BOOT__) {
          observeDshSelection(raw, "initial");
        }
      } catch (_) {
        // ignore
      }
    }, 0);
  }

  installDshSelectionObserver();

  function isHttpUrl(parsed) {
    if (!parsed) {
      return false;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    return true;
  }

  function bridgeSource() {
    return FRAME_ORIGIN === CHAT_ORIGIN
      ? CHAT_BRIDGE_SOURCE
      : EXTERNAL_BRIDGE_SOURCE;
  }

  function getBridgeNonce() {
    try {
      return String(window.name || "");
    } catch (_) {
      return "";
    }
  }

  function isLocalKimiCodeFrame() {
    if (!getBridgeNonce() || FRAME_ORIGIN === CHAT_ORIGIN) {
      return false;
    }
    try {
      const origin = new URL(FRAME_ORIGIN);
      return (
        origin.protocol === "http:" &&
        (origin.hostname === "127.0.0.1" ||
          origin.hostname === "localhost" ||
          origin.hostname === "::1")
      );
    } catch (_) {
      return false;
    }
  }

  function resolveBrowserUrl(rawUrl) {
    const resolved = resolveUrl(rawUrl);
    if (!isHttpUrl(resolved)) {
      return null;
    }
    if (resolved.origin !== FRAME_ORIGIN) {
      return resolved;
    }
    if (!isLocalKimiCodeFrame() || !KIMI_CODE_ACCOUNT_ROUTE_PATTERN.test(resolved.pathname)) {
      return null;
    }

    const browserUrl = new URL(KIMI_BROWSER_ORIGIN);
    browserUrl.pathname = resolved.pathname;
    browserUrl.search = resolved.search;
    browserUrl.hash = resolved.hash;
    return browserUrl;
  }

  function postExternalUrl(url, reason) {
    try {
      if (!window.parent || window.parent === window) {
        return;
      }
      window.parent.postMessage(
        {
          source: bridgeSource(),
          url: url,
          reason: reason || "unknown",
          bridgeNonce: getBridgeNonce(),
        },
        "*",
      );
    } catch (_) {
      // ignore
    }
  }

  document.addEventListener(
    "click",
    function (event) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event && event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      const href = anchor.getAttribute("href") || "";
      if (!href || href.startsWith("#")) {
        return;
      }
      const targetName = (anchor.getAttribute("target") || "").trim().toLowerCase();
      if (targetName && targetName !== "_self") {
        return;
      }

      const browserUrl = resolveBrowserUrl(href);
      if (!browserUrl) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      postExternalUrl(browserUrl.toString(), "anchor_click");
    },
    true,
  );

  ["pushState", "replaceState"].forEach(function (methodName) {
    try {
      const nativeMethod = window.history[methodName];
      if (typeof nativeMethod !== "function") {
        return;
      }
      window.history[methodName] = function (state, title, url) {
        const browserUrl = resolveBrowserUrl(url);
        if (browserUrl) {
          postExternalUrl(browserUrl.toString(), "history_" + methodName);
          return undefined;
        }
        return nativeMethod.apply(this, arguments);
      };
    } catch (_) {
      // ignore
    }
  });

  ["assign", "replace"].forEach(function (methodName) {
    try {
      const nativeMethod = window.location[methodName];
      if (typeof nativeMethod !== "function") {
        return;
      }
      window.location[methodName] = function (url) {
        const browserUrl = resolveBrowserUrl(url);
        if (browserUrl) {
          postExternalUrl(browserUrl.toString(), "location_" + methodName);
          return undefined;
        }
        return nativeMethod.call(window.location, url);
      };
    } catch (_) {
      // Some WebViews expose location methods as non-writable properties.
    }
  });

  try {
    if (window.navigation && typeof window.navigation.addEventListener === "function") {
      window.navigation.addEventListener("navigate", function (event) {
        const browserUrl = resolveBrowserUrl(event.destination && event.destination.url);
        if (!browserUrl) {
          return;
        }
        if (typeof event.preventDefault === "function") {
          event.preventDefault();
        }
        postExternalUrl(browserUrl.toString(), "navigation_api");
      });
    }
  } catch (_) {
    // Navigation API is optional across the embedded WebViews.
  }
})();
