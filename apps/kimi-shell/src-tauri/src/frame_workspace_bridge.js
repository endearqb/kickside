(function () {
  const CHAT_BRIDGE_SOURCE = "kimi-shell-chat-external-link-bridge";
  const EXTERNAL_BRIDGE_SOURCE = "kimi-shell-external-link-bridge";
  const THEME_SYNC_SOURCE = "kimi-shell-theme-sync";
  const SESSION_SYNC_SOURCE = "kimi-shell-session-sync";
  const SESSION_BRIDGE_SOURCE = "kimi-shell-session-bridge";
  const CHAT_ORIGIN = "https://www.kimi.com";
  const MAX_SESSION_ID_LENGTH = 512;
  const THEME_STYLE_ID = "kimi-sidekick-pane-theme";
  const THEME_PALETTES = {
    light: {
      background: "#FBF8F2",
      color: "#101418",
      themeColor: "#FBF8F2",
    },
    dark: {
      background: "#101418",
      color: "#F2EEE7",
      themeColor: "#101418",
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

    document.documentElement.dataset.kimiSidekickTheme = theme;
    if (document.body) {
      document.body.dataset.kimiSidekickTheme = theme;
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
