use super::*;

const THEME_BRIDGE_SOURCE: &str = "kimi-shell-theme-bridge";
const SHELL_THEME_SYNC_SOURCE: &str = "kimi-shell-theme-sync";
const PREFILL_BRIDGE_SOURCE: &str = "kimi-shell-prefill-bridge";
const SHELL_PREFILL_SYNC_SOURCE: &str = "kimi-shell-prefill-sync";
const EXTERNAL_LINK_BRIDGE_SOURCE: &str = "kimi-shell-external-link-bridge";
const SHELL_SESSION_SYNC_SOURCE: &str = "kimi-shell-session-sync";
const SESSION_BRIDGE_SOURCE: &str = "kimi-shell-session-bridge";

pub(super) fn inject_workspace_scripts(
    html: &str,
    upstream_port: u16,
    enhanced_enabled: bool,
) -> String {
    let mut output = inject_theme_bridge_script(html, upstream_port);
    if enhanced_enabled {
        output = inject_enhanced_web_script(&output);
    }
    output
}

pub(super) fn inject_theme_bridge_script(html: &str, upstream_port: u16) -> String {
    const BRIDGE_MARKER: &str = "data-kimi-shell-theme-bridge";
    if html.contains(BRIDGE_MARKER) {
        return html.to_string();
    }

    let bridge_script = theme_bridge_script_tag(upstream_port);
    if let Some(insert_at) = html.rfind("</head>") {
        let mut output = String::with_capacity(html.len() + bridge_script.len() + 8);
        output.push_str(&html[..insert_at]);
        output.push_str(&bridge_script);
        output.push_str(&html[insert_at..]);
        return output;
    }

    format!("{bridge_script}{html}")
}

pub(super) fn inject_enhanced_web_script(html: &str) -> String {
    const ENHANCED_MARKER: &str = "data-kimi-shell-enhanced-web";
    if html.contains(ENHANCED_MARKER) {
        return html.to_string();
    }

    let enhanced_script = enhanced_web_script_tag();
    if let Some(insert_at) = html.rfind("</head>") {
        let mut output = String::with_capacity(html.len() + enhanced_script.len() + 8);
        output.push_str(&html[..insert_at]);
        output.push_str(enhanced_script);
        output.push_str(&html[insert_at..]);
        return output;
    }

    format!("{enhanced_script}{html}")
}

pub(super) fn enhanced_web_script_tag() -> &'static str {
    r#"<style data-kimi-shell-enhanced-web>
html.kimi-shell-enhanced-local {
  --kimi-enhanced-accent: #B67A28;
}

html.kimi-shell-enhanced-local body {
  font-family: "Source Sans 3", "Noto Sans SC", "Microsoft YaHei UI", "Segoe UI Variable Text", sans-serif;
}

html.kimi-shell-enhanced-local [data-kimi-enhanced-empty="true"] {
  letter-spacing: 0;
}

html.kimi-shell-enhanced-local [data-kimi-enhanced-empty="true"] button,
html.kimi-shell-enhanced-local button[data-kimi-enhanced-primary="true"] {
  border-radius: 10px !important;
  min-height: 40px;
  font-weight: 650;
}

html.kimi-shell-enhanced-local input::placeholder,
html.kimi-shell-enhanced-local textarea::placeholder {
  color: color-mix(in srgb, currentColor 48%, transparent);
}

html.kimi-shell-enhanced-local [data-kimi-enhanced-sidebar="true"] {
  scrollbar-color: color-mix(in srgb, var(--kimi-enhanced-accent) 45%, #8c8f98) transparent;
}
</style>
<script data-kimi-shell-enhanced-web>
(function () {
  const READY_SOURCE = "kimi-app-enhanced-web-ready";
  const translationGroups = {
    brand_identity: [
      ["Kimi Code", "kimi小助手"]
    ],
    sessions_sidebar: [
      ["Create a session to begin", "创建会话后开始"],
      ["Click the + button in the sidebar to start a new session", "点击侧栏的 + 按钮开始新会话"],
      ["Create new session", "新建会话"],
      ["Search sessions...", "搜索会话..."],
      ["Search sessions", "搜索会话"],
      ["SESSIONS", "会话"],
      ["Sessions", "会话"],
      ["Archived", "已归档"],
      ["Untitled", "未命名"],
      ["Refresh", "刷新"],
      ["Refresh sessions", "刷新会话"],
      ["Refresh Sessions", "刷新会话"],
      ["New Session", "新建会话"],
      ["New session", "新建会话"],
      ["New session here", "在此新建会话"],
      ["Close sidebar", "关闭侧栏"],
      ["Clear search", "清除搜索"],
      ["List view", "列表视图"],
      ["Grouped view", "分组视图"],
      ["Grouped by folder", "按文件夹分组"],
      ["Delete session", "删除会话"],
      ["Archive session", "归档会话"],
      ["Unarchive session", "取消归档会话"],
      ["Delete Session", "删除会话"],
      ["Are you sure you want to delete", "确定要删除"],
      ["This action cannot be undone.", "此操作无法撤销。"],
      ["Cancel", "取消"],
      ["Delete", "删除"],
      ["Collapse sidebar", "收起侧栏"],
      ["Expand sidebar", "展开侧栏"]
    ],
    ai_reasoning_and_tools: [
      ["Thought", "思考过程"],
      ["Thinking...", "思考中..."],
      ["Copy", "复制"],
      ["Copied!", "已复制！"],
      ["Read", "读取"],
      ["Read Media", "读取媒体"],
      ["Write", "写入"],
      ["Edit", "编辑"],
      ["Find Files", "查找文件"],
      ["Search", "搜索"],
      ["Shell", "命令行"],
      ["Web Search", "网页搜索"],
      ["Fetch URL", "获取 URL"],
      ["Agent Task", "代理任务"],
      ["Create Agent", "创建代理"],
      ["Think", "思考"],
      ["Todo List", "待办列表"],
      ["Send Mail", "发送邮件"]
    ],
    create_session_dialog: [
      ["Create New Session", "新建会话"],
      ["Search directories or type a new path", "搜索目录或输入新路径"],
      ["Search directories or type a path...", "搜索目录或输入路径..."],
      ["No matching directories.", "没有匹配的目录。"],
      ["Loading directories...", "正在加载目录..."],
      ["Type a path to start a new session.", "输入路径以开始新会话。"],
      ["Custom Path", "自定义路径"],
      ["Current Directory", "当前目录"],
      ["Recent Directories", "最近目录"],
      ["Directory Not Found", "目录不存在"],
      ["The directory", "目录"],
      ["does not exist. Would you like to create it?", "不存在。是否创建该目录？"],
      ["Create Directory", "创建目录"]
    ],
    message_search: [
      ["Search Messages", "搜索消息"],
      ["Search in conversation...", "在当前会话中搜索..."],
      ["No messages found", "未找到消息"],
      ["Jump to message", "跳转到消息"],
      ["User", "用户"],
      ["Assistant", "助手"],
      ["Thinking", "思考模式"]
    ],
    workspace_header: [
      ["Open sessions sidebar", "打开会话侧栏"],
      ["Hide workspace files", "隐藏工作区文件"],
      ["Show workspace files", "显示工作区文件"],
      ["Search messages", "搜索消息"],
      ["Fold all blocks", "折叠全部区块"],
      ["Unfold all blocks", "展开全部区块"],
      ["Double-click to rename", "双击以重命名"]
    ],
    approval_dialog: [
      ["Approve", "批准"],
      ["Approving...", "批准中..."],
      ["Approve for session", "批准本会话内后续操作"],
      ["Decline", "拒绝"],
      ["Declining...", "拒绝中..."],
      ["Decline with feedback", "带反馈拒绝"],
      ["Cancel feedback", "取消反馈"],
      ["Tell the model what to do instead...", "告诉模型改为执行什么..."]
    ],
    chat_activity_and_composer: [
      ["Awaiting input", "等待输入"],
      ["Waiting for approval...", "等待批准..."],
      ["Connecting...", "连接中..."],
      ["Loading history...", "加载历史中..."],
      ["Reading files...", "读取文件中..."],
      ["Writing files...", "写入文件中..."],
      ["Editing code...", "编辑代码中..."],
      ["Running command...", "运行命令中..."],
      ["Searching files...", "搜索文件中..."],
      ["Searching content...", "搜索内容中..."],
      ["Fetching web content...", "获取网页内容中..."],
      ["Searching the web...", "搜索网络中..."],
      ["Running agent...", "运行代理中..."],
      ["An error occurred", "发生错误"],
      ["Uploading files...", "上传文件中..."],
      ["Uploading files…", "上传文件中..."],
      ["Create a session to start...", "创建会话后开始..."],
      ["Starting environment...", "启动环境中..."],
      ["Add a follow-up message...", "继续输入后续消息..."],
      ["Ask anything, / for commands, @ to mention files", "输入任何内容，/ 调出命令，@ 提及文件"],
      ["Collapse input", "收起输入框"],
      ["Expand input", "展开输入框"],
      ["Stop generation", "停止生成"],
      ["Queue message", "排队发送消息"]
    ],
    session_context_menu_and_multiselect: [
      ["Rename", "重命名"],
      ["Archive", "归档"],
      ["Unarchive", "取消归档"],
      ["Select Multiple", "批量选择"],
      ["Select all", "全选"],
      ["Deselect all", "取消全选"],
      ["Load more", "加载更多"]
    ],
    toolbar_context_usage: [
      ["Model context usage", "模型上下文占用"],
      ["Input Tokens", "输入 Token"],
      ["Output Tokens", "输出 Token"],
      ["Regular", "常规"],
      ["Cache Read", "缓存读取"],
      ["Cache Write", "缓存写入"],
      ["Total Input", "总输入"],
      ["Generated", "已生成"],
      ["Tokens processed without cache", "未命中缓存处理的 Token"],
      ["Tokens loaded from cache", "从缓存读取的 Token"],
      ["Tokens written to cache", "写入缓存的 Token"]
    ],
    error_boundary: [
      ["Approval action failed", "批准操作失败"],
      ["Question response failed", "问题回复失败"],
      ["Something went wrong", "出现了一些问题"],
      ["An unexpected error occurred", "发生了未预期的错误"],
      ["Copied", "已复制"],
      ["Copy error", "复制错误信息"],
      ["Try again", "重试"]
    ]
  };
  const translations = new Map(Object.values(translationGroups).flat());
  const attrNames = ["placeholder", "aria-label", "title"];
  let scheduled = false;

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function translatePattern(value) {
    let match = value.match(/^Thought for (\d+)s$/);
    if (match) {
      return "思考了 " + match[1] + " 秒";
    }

    match = value.match(/^(\d+(?:\.\d+)?)% context$/i);
    if (match) {
      return match[1] + "% 上下文";
    }

    match = value.match(/^(\d+)\s+selected$/i);
    if (match) {
      return "已选 " + match[1] + " 项";
    }

    return "";
  }

  function translated(value) {
    const key = normalizeText(value);
    return translations.get(key) || translatePattern(key);
  }

  function markEnhancementContext(element, originalText) {
    if (!(element instanceof HTMLElement)) {
      return;
    }
    if (
      originalText === "Create a session to begin" ||
      originalText === "Click the + button in the sidebar to start a new session"
    ) {
      const container = element.closest("main, section, div");
      if (container instanceof HTMLElement) {
        container.dataset.kimiEnhancedEmpty = "true";
      }
    }
    if (originalText === "Create new session") {
      const button = element.closest("button");
      if (button instanceof HTMLElement) {
        button.dataset.kimiEnhancedPrimary = "true";
      }
    }
    if (originalText === "SESSIONS" || originalText === "Search sessions...") {
      const sidebar = element.closest("aside, nav, section, div");
      if (sidebar instanceof HTMLElement) {
        sidebar.dataset.kimiEnhancedSidebar = "true";
      }
    }
  }

  function translateTextNode(node) {
    const parent = node.parentElement;
    if (!parent || parent.closest("script, style, code, pre")) {
      return;
    }
    const original = normalizeText(node.nodeValue);
    const next = translated(original);
    if (!next || node.nodeValue === next) {
      return;
    }
    node.nodeValue = String(node.nodeValue || "").replace(original, next);
    markEnhancementContext(parent, original);
  }

  function translateAttributes(element) {
    if (!(element instanceof HTMLElement)) {
      return;
    }
    for (const attrName of attrNames) {
      const value = element.getAttribute(attrName);
      const next = translated(value);
      if (next) {
        element.setAttribute(attrName, next);
        markEnhancementContext(element, normalizeText(value));
      }
    }
  }

  function walk(root) {
    if (!root) {
      return;
    }
    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) {
      return;
    }

    if (root instanceof HTMLElement) {
      translateAttributes(root);
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let current = walker.currentNode;
    while (current) {
      if (current.nodeType === Node.TEXT_NODE) {
        translateTextNode(current);
      } else if (current instanceof HTMLElement) {
        translateAttributes(current);
      }
      current = walker.nextNode();
    }
  }

  function applyEnhancements() {
    scheduled = false;
    document.documentElement.classList.add("kimi-shell-enhanced-local");
    walk(document.body || document.documentElement);
    try {
      window.parent && window.parent.postMessage(
        { source: READY_SOURCE, ready: true, variant: "proxy_injected_i18n" },
        "*"
      );
    } catch (_) {
      // ignore
    }
  }

  function scheduleApply() {
    if (scheduled) {
      return;
    }
    scheduled = true;
    window.setTimeout(applyEnhancements, 40);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleApply, { once: true });
  } else {
    scheduleApply();
  }

  try {
    const observer = new MutationObserver(scheduleApply);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: attrNames
    });
  } catch (_) {
    // ignore
  }
})();
</script>"#
}

pub(super) fn theme_bridge_script_tag(upstream_port: u16) -> String {
    let upstream_ws_origin = format!("ws://{KIMI_HOST}:{upstream_port}");
    format!(
        r#"<script data-kimi-shell-theme-bridge>
(function () {{
  const THEME_KEY = "kimi-theme";
  const BRIDGE_SOURCE = "{theme_bridge_source}";
  const SHELL_SOURCE = "{shell_theme_source}";
  const PREFILL_SOURCE = "{shell_prefill_source}";
  const PREFILL_ACK_SOURCE = "{prefill_bridge_source}";
  const EXTERNAL_LINK_SOURCE = "{external_link_bridge_source}";
  const SESSION_SYNC_SOURCE = "{shell_session_sync_source}";
  const SESSION_BRIDGE_SOURCE = "{session_bridge_source}";
  const QUERY = "(prefers-color-scheme: dark)";
  const UPSTREAM_WS_ORIGIN = "{upstream_ws_origin}";
  const APP_BRAND_ZH = "kimi小助手";
  const APP_BRAND_EN = "kimi sidekick";
  const UPSTREAM_WS_HOST = (function () {{
    try {{
      return new URL(UPSTREAM_WS_ORIGIN).host;
    }} catch (_) {{
      return "";
    }}
  }})();
  let observedSessionId = "";
  let observedLocationTemplate = "";
  let brandScheduled = false;

  function getBridgeNonce() {{
    try {{
      return String(window.name || "");
    }} catch (_) {{
      return "";
    }}
  }}

  function getAppBrandName() {{
    const languages = Array.isArray(navigator.languages) && navigator.languages.length
      ? navigator.languages
      : [navigator.language || "zh-CN"];
    const language = String(languages[0] || "zh-CN").toLowerCase();
    return language.indexOf("zh") === 0 ? APP_BRAND_ZH : APP_BRAND_EN;
  }}

  function isBrandText(value) {{
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    return normalized === "Kimi Code" || normalized === "Kimi Code Web";
  }}

  function applyWorkspaceBrand(root) {{
    if (!root) {{
      return;
    }}

    const brand = getAppBrandName();
    const replaceTextNode = function (node) {{
      if (!node || !isBrandText(node.nodeValue)) {{
        return;
      }}
      node.nodeValue = String(node.nodeValue || "").replace(/Kimi Code(?: Web)?/, brand);
    }};

    if (root.nodeType === Node.TEXT_NODE) {{
      replaceTextNode(root);
      return;
    }}
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) {{
      return;
    }}

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let current = walker.currentNode;
    while (current) {{
      replaceTextNode(current);
      current = walker.nextNode();
    }}

    const elements = root instanceof Element
      ? [root].concat(Array.from(root.querySelectorAll("[title], [aria-label]")))
      : Array.from(document.querySelectorAll("[title], [aria-label]"));
    elements.forEach(function (element) {{
      ["title", "aria-label"].forEach(function (attrName) {{
        const value = element.getAttribute(attrName);
        if (isBrandText(value)) {{
          element.setAttribute(attrName, brand);
        }}
      }});
    }});
  }}

  function scheduleWorkspaceBrand() {{
    if (brandScheduled) {{
      return;
    }}
    brandScheduled = true;
    window.setTimeout(function () {{
      brandScheduled = false;
      applyWorkspaceBrand(document.body || document.documentElement);
    }}, 40);
  }}

  function normalizeTheme(value) {{
    return value === "light" || value === "dark" ? value : "system";
  }}

  function resolveTheme(mode) {{
    if (mode === "light" || mode === "dark") {{
      return mode;
    }}
    const prefersDark = window.matchMedia && window.matchMedia(QUERY).matches;
    return prefersDark ? "dark" : "light";
  }}

  function notifyParent() {{
    try {{
      if (window.parent && window.parent !== window) {{
        const current = normalizeTheme(localStorage.getItem(THEME_KEY));
        window.parent.postMessage({{ source: BRIDGE_SOURCE, theme: current }}, "*");
      }}
    }} catch (_) {{
      // ignore
    }}
  }}

  function applyDomTheme(mode) {{
    try {{
      const resolved = resolveTheme(mode);
      const root = document.documentElement;
      root.classList.toggle("dark", resolved === "dark");
      root.style.colorScheme = resolved;
    }} catch (_) {{
      // ignore
    }}
  }}

  function applyThemeFromShell(mode) {{
    const normalized = normalizeTheme(mode);
    try {{
      if (normalized === "system") {{
        localStorage.removeItem(THEME_KEY);
      }} else {{
        localStorage.setItem(THEME_KEY, normalized);
      }}
    }} catch (_) {{
      // ignore
    }}
    applyDomTheme(normalized);
    notifyParent();
  }}

  function postPrefillAck(payload) {{
    try {{
      if (window.parent && window.parent !== window) {{
        window.parent.postMessage(
          {{
            source: PREFILL_ACK_SOURCE,
            requestId: payload.requestId,
            applied: !!payload.applied,
            reason: payload.reason || ""
          }},
          "*"
        );
      }}
    }} catch (_) {{
      // ignore
    }}
  }}

  function postExternalLink(url, reason) {{
    try {{
      if (!window.parent || window.parent === window) {{
        return;
      }}
      window.parent.postMessage(
        {{
          source: EXTERNAL_LINK_SOURCE,
          url: url,
          bridgeNonce: getBridgeNonce(),
          reason: reason || "unknown"
        }},
        "*"
      );
    }} catch (_) {{
      // ignore
    }}
  }}

  function postSessionBridge(payload) {{
    try {{
      if (!window.parent || window.parent === window) {{
        return;
      }}
      window.parent.postMessage(
        {{
          source: SESSION_BRIDGE_SOURCE,
          action: payload.action || "",
          requestId: payload.requestId || "",
          sessionId: payload.sessionId || "",
          routeTemplate: payload.routeTemplate || "",
          applied: !!payload.applied,
          reason: payload.reason || ""
        }},
        "*"
      );
    }} catch (_) {{
      // ignore
    }}
  }}

  function extractSessionIdFromPath(pathname) {{
    if (typeof pathname !== "string") {{
      return "";
    }}
    const match = pathname.match(/^\/api\/sessions\/([^/]+)\/stream$/);
    return match && match[1] ? decodeURIComponent(match[1]) : "";
  }}

  function observeSessionRouteTemplate(resolvedUrl) {{
    const sessionId = extractSessionIdFromPath(resolvedUrl.pathname);
    if (!sessionId) {{
      return;
    }}

    observedSessionId = sessionId;
    if (!observedLocationTemplate && window.location.href.indexOf(sessionId) >= 0) {{
      observedLocationTemplate = window.location.href.split(sessionId).join("{{session_id}}");
    }}

    postSessionBridge({{
      action: "route_template_observed",
      sessionId: sessionId,
      routeTemplate: observedLocationTemplate || "",
      applied: true,
      reason: observedLocationTemplate ? "location_template" : "session_seen_without_location_template"
    }});
  }}

  function buildQuerySessionFallback(sessionId) {{
    try {{
      const parsed = new URL(window.location.href);
      parsed.pathname = "/";
      parsed.search = "?session=" + encodeURIComponent(sessionId);
      parsed.hash = "";
      return parsed.toString();
    }} catch (_) {{
      return "/?session=" + encodeURIComponent(sessionId);
    }}
  }}

  function tryBuildNavigateTarget(sessionId, routeTemplate) {{
    if (!sessionId) {{
      return "";
    }}

    const template = typeof routeTemplate === "string" && routeTemplate.indexOf("{{session_id}}") >= 0
      ? routeTemplate
      : observedLocationTemplate;
    if (template) {{
      return template.split("{{session_id}}").join(encodeURIComponent(sessionId));
    }}

    const href = String(window.location.href || "");
    if (observedSessionId && href.indexOf(observedSessionId) >= 0) {{
      return href.split(observedSessionId).join(encodeURIComponent(sessionId));
    }}
    return buildQuerySessionFallback(sessionId);
  }}

  function navigateToSession(data) {{
    const requestId = typeof data.requestId === "string" ? data.requestId : "";
    const sessionId = typeof data.sessionId === "string" ? data.sessionId.trim() : "";
    const routeTemplate = typeof data.routeTemplate === "string" ? data.routeTemplate : "";
    const hasTemplate =
      typeof routeTemplate === "string" &&
      routeTemplate.indexOf("{{session_id}}") >= 0;
    const usedObservedTemplate = !hasTemplate && !!observedLocationTemplate;

    if (!sessionId) {{
      postSessionBridge({{
        action: "navigate_session_ack",
        requestId,
        sessionId,
        applied: false,
        reason: "missing_session_id"
      }});
      return;
    }}

    const target = tryBuildNavigateTarget(sessionId, routeTemplate);
    if (!target) {{
      postSessionBridge({{
        action: "navigate_session_ack",
        requestId,
        sessionId,
        applied: false,
        reason: "missing_or_unusable_route_template"
      }});
      return;
    }}

    try {{
      window.location.assign(target);
      postSessionBridge({{
        action: "navigate_session_ack",
        requestId,
        sessionId,
        routeTemplate: routeTemplate || observedLocationTemplate || "/?session={{session_id}}",
        applied: true,
        reason: hasTemplate
          ? "navigated_with_route_template"
          : usedObservedTemplate
            ? "navigated_with_observed_template"
            : "navigated_with_query_fallback"
      }});
    }} catch (_) {{
      postSessionBridge({{
        action: "navigate_session_ack",
        requestId,
        sessionId,
        applied: false,
        reason: "navigate_exception"
      }});
    }}
  }}

  function shouldOpenExternally(url) {{
    if (!url) {{
      return false;
    }}
    try {{
      const parsed = new URL(url, window.location.href);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {{
        return false;
      }}
      return parsed.origin !== window.location.origin;
    }} catch (_) {{
      return false;
    }}
  }}

  function isVisible(element) {{
    if (!element || !element.isConnected) {{
      return false;
    }}
    const style = window.getComputedStyle(element);
    if (!style || style.display === "none" || style.visibility === "hidden") {{
      return false;
    }}
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }}

  function findComposerElement() {{
    const selectors = [
      "textarea[placeholder*='鍙戦€?]",
      "textarea[placeholder*='Send']",
      "textarea[aria-label*='鍙戦€?]",
      "textarea[aria-label*='Send']",
      "textarea",
      "[contenteditable='true'][role='textbox']",
      "[contenteditable='true'][data-lexical-editor='true']",
      "[contenteditable='true']"
    ];

    for (const selector of selectors) {{
      const nodes = Array.from(document.querySelectorAll(selector));
      const target = nodes.find((node) => {{
        if (!(node instanceof HTMLElement)) {{
          return false;
        }}
        if (!isVisible(node)) {{
          return false;
        }}
        if ("disabled" in node && node.disabled) {{
          return false;
        }}
        if (node.getAttribute("aria-disabled") === "true") {{
          return false;
        }}
        return true;
      }});
      if (target) {{
        return target;
      }}
    }}

    return null;
  }}

  function writeComposerValue(target, text) {{
    if (!target) {{
      return false;
    }}

    try {{
      target.focus();
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {{
        target.value = text;
        target.dispatchEvent(new Event("input", {{ bubbles: true }}));
        target.dispatchEvent(new Event("change", {{ bubbles: true }}));
        return true;
      }}

      if (target instanceof HTMLElement && target.isContentEditable) {{
        target.textContent = text;
        try {{
          target.dispatchEvent(
            new InputEvent("input", {{
              bubbles: true,
              data: text,
              inputType: "insertText"
            }})
          );
        }} catch (_) {{
          target.dispatchEvent(new Event("input", {{ bubbles: true }}));
        }}
        return true;
      }}
    }} catch (_) {{
      return false;
    }}

    return false;
  }}

  function findSendButton() {{
    const selectors = [
      "button[type='submit']",
      "button[aria-label*='鍙戦€?]",
      "button[aria-label*='Send']",
      "button[data-testid*='send']",
      "button[data-icon*='send']"
    ];

    for (const selector of selectors) {{
      const nodes = Array.from(document.querySelectorAll(selector));
      const button = nodes.find((node) => {{
        if (!(node instanceof HTMLButtonElement)) {{
          return false;
        }}
        if (!isVisible(node)) {{
          return false;
        }}
        if (node.disabled || node.getAttribute("aria-disabled") === "true") {{
          return false;
        }}
        return true;
      }});
      if (button) {{
        return button;
      }}
    }}
    return null;
  }}

  function triggerSend(target) {{
    const sendButton = findSendButton();
    if (sendButton) {{
      sendButton.click();
      return true;
    }}

    const keyboardEventInit = {{
      key: "Enter",
      code: "Enter",
      which: 13,
      keyCode: 13,
      bubbles: true,
      cancelable: true
    }};

    try {{
      target.dispatchEvent(new KeyboardEvent("keydown", keyboardEventInit));
      target.dispatchEvent(new KeyboardEvent("keypress", keyboardEventInit));
      target.dispatchEvent(new KeyboardEvent("keyup", keyboardEventInit));
      return true;
    }} catch (_) {{
      return false;
    }}
  }}

  function applyPrefillFromShell(data) {{
    const requestId = typeof data.requestId === "string" ? data.requestId : "";
    const text = typeof data.text === "string" ? data.text : "";
    const autoSend = data.autoSend !== false;

    if (!requestId) {{
      postPrefillAck({{ requestId: "", applied: false, reason: "missing_request_id" }});
      return;
    }}

    if (!text.trim()) {{
      postPrefillAck({{ requestId, applied: false, reason: "empty_text" }});
      return;
    }}

    const target = findComposerElement();
    if (!target) {{
      postPrefillAck({{ requestId, applied: false, reason: "composer_not_found" }});
      return;
    }}

    if (!writeComposerValue(target, text)) {{
      postPrefillAck({{ requestId, applied: false, reason: "composer_write_failed" }});
      return;
    }}

    if (!autoSend) {{
      postPrefillAck({{ requestId, applied: true, reason: "filled_only" }});
      return;
    }}

    setTimeout(function () {{
      const sent = triggerSend(target);
      postPrefillAck({{
        requestId,
        applied: sent,
        reason: sent ? "sent" : "send_failed"
      }});
    }}, 50);
  }}

  function maybeRewriteWebSocketUrl(rawUrl) {{
    if (!UPSTREAM_WS_HOST) {{
      return rawUrl;
    }}
    try {{
      const resolved = new URL(String(rawUrl), window.location.href);
      const isSameProxyHost = resolved.host === window.location.host;
      const isSessionStream = /^\/api\/sessions\/[^/]+\/stream$/.test(resolved.pathname);
      if (isSessionStream) {{
        observeSessionRouteTemplate(resolved);
      }}
      if (!isSameProxyHost || !isSessionStream) {{
        return rawUrl;
      }}
      resolved.protocol = "ws:";
      resolved.host = UPSTREAM_WS_HOST;
      return resolved.toString();
    }} catch (_) {{
      return rawUrl;
    }}
  }}

  try {{
    const NativeWebSocket = window.WebSocket;
    if (typeof NativeWebSocket === "function") {{
      const PatchedWebSocket = function(url, protocols) {{
        const rewritten = maybeRewriteWebSocketUrl(url);
        if (typeof protocols === "undefined") {{
          return new NativeWebSocket(rewritten);
        }}
        return new NativeWebSocket(rewritten, protocols);
      }};
      PatchedWebSocket.prototype = NativeWebSocket.prototype;
      Object.setPrototypeOf(PatchedWebSocket, NativeWebSocket);
      PatchedWebSocket.CONNECTING = NativeWebSocket.CONNECTING;
      PatchedWebSocket.OPEN = NativeWebSocket.OPEN;
      PatchedWebSocket.CLOSING = NativeWebSocket.CLOSING;
      PatchedWebSocket.CLOSED = NativeWebSocket.CLOSED;
      window.WebSocket = PatchedWebSocket;
    }}
  }} catch (_) {{
    // ignore
  }}

  try {{
    document.addEventListener(
      "click",
      function(event) {{
        const target = event && event.target;
        if (!(target instanceof Element)) {{
          return;
        }}
        const anchor = target.closest("a[href]");
        if (!(anchor instanceof HTMLAnchorElement)) {{
          return;
        }}
        const href = anchor.getAttribute("href") || "";
        if (!shouldOpenExternally(href)) {{
          return;
        }}
        event.preventDefault();
        event.stopPropagation();
        postExternalLink(new URL(href, window.location.href).toString(), "anchor_click");
      }},
      true
    );
  }} catch (_) {{
    // ignore
  }}

  try {{
    const nativeWindowOpen = window.open;
    if (typeof nativeWindowOpen === "function") {{
      window.open = function(url, target, features) {{
        const resolvedUrl = typeof url === "string" ? url : String(url || "");
        if (shouldOpenExternally(resolvedUrl)) {{
          postExternalLink(new URL(resolvedUrl, window.location.href).toString(), "window_open");
          return null;
        }}
        return nativeWindowOpen.call(window, url, target, features);
      }};
    }}
  }} catch (_) {{
    // ignore
  }}

  try {{
    const originalSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function (key, value) {{
      const result = originalSetItem(key, value);
      if (key === THEME_KEY) {{
        notifyParent();
      }}
      return result;
    }};

    const originalRemoveItem = localStorage.removeItem.bind(localStorage);
    localStorage.removeItem = function (key) {{
      const result = originalRemoveItem(key);
      if (key === THEME_KEY) {{
        notifyParent();
      }}
      return result;
    }};
  }} catch (_) {{
    // ignore
  }}

  window.addEventListener("message", function (event) {{
    const data = event && event.data;
    if (!data || !data.source) {{
      return;
    }}
    if (data.source === SHELL_SOURCE) {{
      applyThemeFromShell(data.theme);
      return;
    }}
    if (data.source === PREFILL_SOURCE) {{
      applyPrefillFromShell(data);
      return;
    }}
    if (data.source === SESSION_SYNC_SOURCE) {{
      const action = typeof data.action === "string" ? data.action : "";
      if (action === "navigate_session") {{
        navigateToSession(data);
      }}
    }}
  }});

  if (document.readyState === "loading") {{
    document.addEventListener("DOMContentLoaded", function () {{
      notifyParent();
      applyDomTheme(normalizeTheme(localStorage.getItem(THEME_KEY)));
      scheduleWorkspaceBrand();
    }}, {{ once: true }});
  }} else {{
    notifyParent();
    applyDomTheme(normalizeTheme(localStorage.getItem(THEME_KEY)));
    scheduleWorkspaceBrand();
  }}

  setTimeout(notifyParent, 0);
  setTimeout(scheduleWorkspaceBrand, 0);
  setTimeout(scheduleWorkspaceBrand, 250);

  try {{
    const brandObserver = new MutationObserver(scheduleWorkspaceBrand);
    brandObserver.observe(document.documentElement, {{
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["title", "aria-label"]
    }});
  }} catch (_) {{
    // ignore
  }}
}})();
</script>"#,
        theme_bridge_source = THEME_BRIDGE_SOURCE,
        shell_theme_source = SHELL_THEME_SYNC_SOURCE,
        prefill_bridge_source = PREFILL_BRIDGE_SOURCE,
        shell_prefill_source = SHELL_PREFILL_SYNC_SOURCE,
        external_link_bridge_source = EXTERNAL_LINK_BRIDGE_SOURCE,
        shell_session_sync_source = SHELL_SESSION_SYNC_SOURCE,
        session_bridge_source = SESSION_BRIDGE_SOURCE,
        upstream_ws_origin = upstream_ws_origin
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn theme_bridge_script_contains_session_route_template_and_query_fallback() {
        let script = theme_bridge_script_tag(57999);
        assert!(
            script.contains(r#"routeTemplate.indexOf("{{session_id}}")"#)
                || script.contains(r#"routeTemplate.indexOf("{session_id}")"#)
        );
        assert!(script.contains("return buildQuerySessionFallback(sessionId);"));
        assert!(
            script.contains(
                r#"routeTemplate || observedLocationTemplate || "/?session={{session_id}}""#
            ) || script.contains(
                r#"routeTemplate || observedLocationTemplate || "/?session={session_id}""#
            )
        );
    }

    #[test]
    fn theme_bridge_script_rebrands_workspace_code_label() {
        let script = theme_bridge_script_tag(57999);
        assert!(script.contains(r#"APP_BRAND_ZH = "kimi小助手""#));
        assert!(script.contains(r#"APP_BRAND_EN = "kimi sidekick""#));
        assert!(script.contains(r#"normalized === "Kimi Code""#));
        assert!(script.contains("applyWorkspaceBrand"));
    }

    #[test]
    fn theme_bridge_script_attaches_external_link_nonce() {
        let script = theme_bridge_script_tag(57999);
        assert!(script.contains("function getBridgeNonce()"));
        assert!(script.contains("bridgeNonce: getBridgeNonce()"));
    }
}
