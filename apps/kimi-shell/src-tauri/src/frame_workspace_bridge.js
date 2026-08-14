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
  const DSH_SESSION_STORAGE_KEY = "dsh.sessions.current";
  const CHAT_ORIGIN = "https://www.kimi.com";
  const MAX_SESSION_ID_LENGTH = 512;
  const MAX_DSH_WORK_DIR_LENGTH = 32768;
  const THEME_STYLE_ID = "kimi-sidekick-pane-theme";
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

  window.addEventListener("message", function (event) {
    const data = event && event.data;
    if (!data) {
      return;
    }
    if (data.source === THEME_SYNC_SOURCE) {
      applyPaneTheme(data.theme);
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

  function isExternalHttpUrl(parsed) {
    if (!parsed) {
      return false;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    return parsed.origin !== FRAME_ORIGIN;
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

      const resolved = resolveUrl(href);
      if (!isExternalHttpUrl(resolved)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      postExternalUrl(resolved.toString(), "anchor_click");
    },
    true,
  );

  try {
    const nativeWindowOpen = window.open;
    if (typeof nativeWindowOpen === "function") {
      window.open = function (url, target, features) {
        const resolved = resolveUrl(
          typeof url === "string" ? url : String(url || ""),
        );
        if (isExternalHttpUrl(resolved)) {
          postExternalUrl(resolved.toString(), "window_open");
          return null;
        }
        return nativeWindowOpen.call(window, url, target, features);
      };
    }
  } catch (_) {
    // ignore
  }
})();
