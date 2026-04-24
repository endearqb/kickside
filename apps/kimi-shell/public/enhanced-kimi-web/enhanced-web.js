const SHELL_READY_SOURCE = "kimi-app-enhanced-web-ready";
const THEME_SYNC_SOURCE = "kimi-shell-theme-sync";
const THEME_BRIDGE_SOURCE = "kimi-shell-theme-bridge";
const SESSION_SYNC_SOURCE = "kimi-shell-session-sync";
const SESSION_BRIDGE_SOURCE = "kimi-shell-session-bridge";
const PREFILL_SYNC_SOURCE = "kimi-shell-prefill-sync";
const PREFILL_BRIDGE_SOURCE = "kimi-shell-prefill-bridge";
const EXTERNAL_LINK_BRIDGE_SOURCE = "kimi-shell-external-link-bridge";

const frame = document.getElementById("kimi-frame");
const loading = document.getElementById("enhanced-loading");
const meta = document.getElementById("enhanced-meta");
const shell = document.querySelector(".enhanced-shell");
const title = document.querySelector(".enhanced-title strong");
const params = new URLSearchParams(window.location.search);
const upstreamUrl = params.get("workspaceUrl") || params.get("upstream");
const initialTheme = params.get("theme") === "dark" ? "dark" : "light";
let frameReady = false;
let pendingMessages = [];
let messages = {
  "app.title": "Kimi Web 本地增强版",
  "loading.workspace": "正在接入 Kimi Web...",
  "error.missingWorkspaceUrl": "缺少 Kimi Web 工作区地址。",
};

function setTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  shell?.setAttribute("data-theme", nextTheme);
  document.documentElement.style.colorScheme = nextTheme;
}

function targetOrigin() {
  try {
    return upstreamUrl ? new URL(upstreamUrl).origin : "*";
  } catch {
    return "*";
  }
}

function postToFrame(payload) {
  if (!frame?.contentWindow) {
    return;
  }
  if (!frameReady) {
    pendingMessages.push(payload);
    return;
  }
  frame.contentWindow.postMessage(payload, targetOrigin());
}

function flushPendingMessages() {
  const queued = pendingMessages;
  pendingMessages = [];
  for (const payload of queued) {
    postToFrame(payload);
  }
}

function sendShellReady() {
  window.parent?.postMessage(
    {
      source: SHELL_READY_SOURCE,
      ready: true,
      variant: "enhanced_local_wrapper",
      upstreamUrl,
    },
    "*",
  );
}

setTheme(initialTheme);

fetch("./i18n/zh-CN.json")
  .then((response) => response.json())
  .then((nextMessages) => {
    messages = { ...messages, ...nextMessages };
    if (title) {
      title.textContent = messages["app.title"];
    }
    const loadingText = loading?.querySelector("p");
    if (loadingText) {
      loadingText.textContent = messages["loading.workspace"];
    }
  })
  .catch(() => {
    // Built-in Chinese strings remain available.
  });

fetch("./manifest.json")
  .then((response) => response.json())
  .then((manifest) => {
    meta.textContent = `来源 commit ${manifest.upstreamCommit?.slice(0, 12) ?? "-"}`;
  })
  .catch(() => {
    meta.textContent = "来源元数据不可用";
  });

if (upstreamUrl && frame) {
  frame.src = upstreamUrl;
} else if (loading) {
  loading.innerHTML = `<p>${messages["error.missingWorkspaceUrl"]}</p>`;
}

frame?.addEventListener("load", () => {
  frameReady = true;
  loading?.classList.add("is-hidden");
  flushPendingMessages();
  sendShellReady();
});

window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") {
    return;
  }

  if (data.source === THEME_SYNC_SOURCE) {
    setTheme(data.theme);
    postToFrame(data);
    return;
  }

  if (data.source === SESSION_SYNC_SOURCE || data.source === PREFILL_SYNC_SOURCE) {
    postToFrame(data);
    return;
  }

  if (data.source === THEME_BRIDGE_SOURCE) {
    setTheme(data.theme);
    window.parent?.postMessage(data, "*");
    return;
  }

  if (
    data.source === SESSION_BRIDGE_SOURCE ||
    data.source === PREFILL_BRIDGE_SOURCE ||
    data.source === EXTERNAL_LINK_BRIDGE_SOURCE
  ) {
    window.parent?.postMessage(data, "*");
  }
});

window.setTimeout(() => {
  sendShellReady();
}, 1200);
