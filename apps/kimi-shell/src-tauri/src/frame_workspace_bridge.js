(function () {
  const CHAT_BRIDGE_SOURCE = "kimi-shell-chat-external-link-bridge";
  const EXTERNAL_BRIDGE_SOURCE = "kimi-shell-external-link-bridge";
  const THEME_SYNC_SOURCE = "kimi-shell-theme-sync";
  const CHAT_ORIGIN = "https://www.kimi.com";
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
    if (!data || data.source !== THEME_SYNC_SOURCE) {
      return;
    }
    applyPaneTheme(data.theme);
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
