import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { RootErrorBoundary } from "@/app/RootErrorBoundary";
import { AgentRoomWindowApp } from "@/features/agent-room/AgentRoomWindowApp";
import { getKimiAssistantDisplayName } from "@/lib/appBrand";

const appDisplayName = getKimiAssistantDisplayName();
const RootApp = window.location.hash.replace(/^#\/?/, "") === "agent-room"
  ? AgentRoomWindowApp
  : App;

function markBootFallbackAsMounting() {
  const fallback = document.getElementById("boot-fallback");
  if (!fallback) return;
  fallback.setAttribute("data-state", "mounting");
}

function removeBootFallback() {
  const fallback = document.getElementById("boot-fallback");
  if (!fallback) return;
  fallback.remove();
}

function setupGlobalStartupErrorHandlers() {
  const fallback = document.getElementById("boot-fallback");
  if (!fallback) return;
  document.title = appDisplayName;

  const setFailureMessage = (message: string) => {
    const card = document.getElementById("boot-fallback-card");
    if (!card) return;
    card.innerHTML = `
      <h1 style="margin:0 0 8px;font-size:15px;line-height:1.35;">${appDisplayName}启动失败</h1>
      <p style="margin:0;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;">
${message}
      </p>
    `;
  };

  window.addEventListener("error", (event) => {
    const message =
      event.error instanceof Error
        ? event.error.message
        : event.message || "Unknown script error";
    setFailureMessage(
      `检测到前端异常：${message}\n请重启应用；若仍失败，请提供日志文件 %LOCALAPPDATA%\\com.kimi.shell\\logs\\app.log。`,
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason =
      event.reason instanceof Error
        ? event.reason.message
        : String(event.reason ?? "Unknown rejection");
    setFailureMessage(
      `检测到未处理 Promise 异常：${reason}\n请重启应用；若仍失败，请提供日志文件 %LOCALAPPDATA%\\com.kimi.shell\\logs\\app.log。`,
    );
  });
}

function BootReadyMarker() {
  React.useEffect(() => {
    removeBootFallback();
  }, []);
  return null;
}

markBootFallbackAsMounting();
setupGlobalStartupErrorHandlers();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BootReadyMarker />
    <RootErrorBoundary>
      <RootApp />
    </RootErrorBoundary>
  </React.StrictMode>,
);
