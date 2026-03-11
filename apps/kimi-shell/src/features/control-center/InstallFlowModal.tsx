import { useEffect, useMemo, useRef } from "react";
import { Copy, RefreshCw, SquareTerminal, X } from "lucide-react";
import type {
  BackendState,
  InstallFlowCatalog,
  InstallProbeStatus,
  InstallSessionSnapshot,
  InstallSource,
  InstallTaskDefinition,
  InstallTaskId,
} from "@/app/types";
import { Button } from "@/components/ui/button";

type InstallFlowModalProps = {
  open: boolean;
  catalog: InstallFlowCatalog | null;
  session: InstallSessionSnapshot;
  probe: InstallProbeStatus | null;
  backendState: BackendState | null;
  installSource: InstallSource;
  onClose: () => void;
  onRefreshProbe: () => Promise<unknown>;
  onSourceChange: (source: InstallSource) => void;
  onStartTask: (taskId: InstallTaskId) => Promise<void>;
  onCancelTask: () => Promise<void>;
  onRestartBackend: () => Promise<void>;
  restartBusy: boolean;
};

type TaskAvailability = {
  disabled: boolean;
  reason?: string;
};

function copyText(value: string) {
  return navigator.clipboard.writeText(value);
}

function taskSteps(task: InstallTaskDefinition | undefined, source: InstallSource) {
  if (!task) return [];
  return source === "mirror" && task.mirrorSteps.length ? task.mirrorSteps : task.officialSteps;
}

function buildTaskCommands(task: InstallTaskDefinition | undefined, source: InstallSource) {
  return taskSteps(task, source)
    .map(
      (step, index) =>
        `# ${index + 1}. ${step.title}\n# ${step.description}\n${step.command.trim()}`,
    )
    .join("\n\n")
    .trim();
}

function statusLabel(value?: boolean) {
  if (value === true) return "Ready";
  if (value === false) return "Missing";
  return "-";
}

function getTaskAvailability(
  taskId: InstallTaskId,
  probe: InstallProbeStatus | null,
  isBusy: boolean,
): TaskAvailability {
  if (isBusy) {
    return { disabled: true, reason: "任务执行中" };
  }
  if (!probe) {
    return { disabled: true, reason: "等待环境检测" };
  }

  switch (taskId) {
    case "quick_install_core":
      return probe.coreReady
        ? { disabled: true, reason: "基础环境已就绪" }
        : { disabled: false };
    case "install_uv":
      return probe.uvReady ? { disabled: true, reason: "已安装" } : { disabled: false };
    case "install_python313":
      return probe.python313Ready ? { disabled: true, reason: "已安装" } : { disabled: false };
    case "install_kimi":
      return probe.kimiReady ? { disabled: true, reason: "已安装" } : { disabled: false };
    case "upgrade_kimi":
      return probe.kimiReady
        ? { disabled: false }
        : { disabled: true, reason: "需先安装 Kimi CLI" };
    case "install_git":
      return probe.gitReady ? { disabled: true, reason: "已安装" } : { disabled: false };
    case "install_nodejs":
      return probe.nodeReady ? { disabled: true, reason: "已安装" } : { disabled: false };
    default:
      return { disabled: false };
  }
}

function buildLogsText(session: InstallSessionSnapshot) {
  const lines: string[] = [];

  const pushUnique = (value?: string) => {
    const trimmed = value?.trim();
    if (!trimmed || lines.includes(trimmed)) {
      return;
    }
    lines.push(trimmed);
  };

  if (session.status === "failed" && session.failureSummary) {
    pushUnique(`[failure] ${session.failureSummary}`);
  }

  if (!session.logs.length) {
    if (session.lastStderr) {
      pushUnique(`[stderr] ${session.lastStderr}`);
    }
    if (session.lastStdout) {
      pushUnique(`[stdout] ${session.lastStdout}`);
    }
  }

  for (const chunk of session.logs) {
    pushUnique(`[${chunk.stream}] ${chunk.text}`);
  }

  return lines.join("\n");
}

export function InstallFlowModal({
  open,
  catalog,
  session,
  probe,
  backendState,
  installSource,
  onClose,
  onRefreshProbe,
  onSourceChange,
  onStartTask,
  onCancelTask,
  onRestartBackend,
  restartBusy,
}: InstallFlowModalProps) {
  const consoleRef = useRef<HTMLPreElement | null>(null);
  const activeTask = useMemo(
    () => catalog?.tasks.find((task) => task.id === session.taskId),
    [catalog, session.taskId],
  );
  const isBusy =
    session.status === "starting" ||
    session.status === "running" ||
    session.status === "cancelling";
  const coreTasks = catalog?.tasks.filter((task) => task.group === "core") ?? [];
  const optionalTasks = catalog?.tasks.filter((task) => task.group === "optional") ?? [];
  const upgradeTasks = catalog?.tasks.filter((task) => task.group === "upgrade") ?? [];
  const currentStepCommand =
    taskSteps(activeTask, installSource).find((step) => step.id === session.currentStepId)
      ?.command ?? "";
  const fullTaskCommands = buildTaskCommands(activeTask, installSource);
  const logsText = buildLogsText(session);
  const failureSummary =
    session.status === "failed" ? session.failureSummary?.trim() || session.message?.trim() : "";
  const showRestartAction =
    session.taskId === "upgrade_kimi" &&
    !isBusy &&
    session.status !== "idle" &&
    backendState !== "running" &&
    backendState !== "starting";
  const restartHint = showRestartAction
    ? session.status === "succeeded"
      ? "升级前已停止应用后端以释放 kimi.exe。升级完成后请点击重启后端。"
      : "升级前已停止应用后端以释放 kimi.exe。如需恢复使用，请点击重启后端。"
    : "";

  useEffect(() => {
    if (!open) return;
    const node = consoleRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [open, session.logs.length, failureSummary, restartHint]);

  if (!open) {
    return null;
  }

  const renderTaskButton = (
    task: InstallTaskDefinition,
    variant: "default" | "outline" | "ghost",
  ) => {
    const availability = getTaskAvailability(task.id, probe, isBusy);
    return (
      <div key={task.id} className="cc-install-task-item">
        <Button
          type="button"
          variant={variant}
          className="cc-action-btn"
          onClick={() => void onStartTask(task.id)}
          disabled={availability.disabled}
          title={availability.reason}
        >
          {task.title}
        </Button>
        <p className="hint cc-install-task-hint">{availability.reason ?? " "}</p>
      </div>
    );
  };

  return (
    <div
      className="cc-install-flow-modal-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="cc-install-flow-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Install and upgrade"
      >
        <header className="cc-install-flow-header">
          <div>
            <h3>安装与升级</h3>
            <p>基础安装在应用内执行，可选增强项可能会打开外部管理员终端。</p>
          </div>
          <div className="cc-install-flow-header-actions">
            <Button
              type="button"
              variant="outline"
              icon={<RefreshCw size={14} />}
              className="cc-action-btn"
              onClick={() => void onRefreshProbe()}
            >
              重新检测
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              icon={<X size={16} />}
              onClick={onClose}
              aria-label="Close install flow"
            />
          </div>
        </header>

        <div className="cc-install-flow-source" role="group" aria-label="Install source">
          <button
            type="button"
            className={`cc-source-switch-btn ${installSource === "official" ? "active" : ""}`}
            onClick={() => onSourceChange("official")}
            disabled={isBusy}
          >
            官方源
          </button>
          <button
            type="button"
            className={`cc-source-switch-btn ${installSource === "mirror" ? "active" : ""}`}
            onClick={() => onSourceChange("mirror")}
            disabled={isBusy}
          >
            镜像源
          </button>
        </div>

        <section className="cc-install-flow-section">
          <h4>环境状态</h4>
          <div className="cc-install-status-grid">
            <span>winget: {statusLabel(probe?.wingetReady)}</span>
            <span>uv: {statusLabel(probe?.uvReady)}</span>
            <span>Python 3.13: {statusLabel(probe?.python313Ready)}</span>
            <span>Kimi CLI: {statusLabel(probe?.kimiReady)}</span>
            <span>Git: {statusLabel(probe?.gitReady)}</span>
            <span>Node.js: {statusLabel(probe?.nodeReady)}</span>
            <span>Core Ready: {statusLabel(probe?.coreReady)}</span>
          </div>
        </section>

        <section className="cc-install-flow-section">
          <h4>基础安装</h4>
          <div className="cc-install-task-list">
            {coreTasks.map((task) => renderTaskButton(task, task.recommended ? "default" : "outline"))}
          </div>
        </section>

        <section className="cc-install-flow-section">
          <h4>升级与可选增强</h4>
          <div className="cc-install-task-list">
            {upgradeTasks.map((task) => renderTaskButton(task, "outline"))}
            {optionalTasks.map((task) => renderTaskButton(task, "ghost"))}
          </div>
          {optionalTasks.length ? (
            <p className="hint">Git / Node.js 为可选增强项，可能需要管理员权限。</p>
          ) : null}
        </section>

        <section className="cc-install-flow-section">
          <div className="cc-install-console-head">
            <div>
              <h4>控制台</h4>
              <p>
                {session.title ?? "No active task"} · {session.status} · {session.stage}
              </p>
            </div>
            <div className="cc-install-flow-actions">
              <Button
                type="button"
                variant="outline"
                icon={<Copy size={14} />}
                className="cc-action-btn"
                onClick={() => void copyText(currentStepCommand)}
                disabled={!currentStepCommand}
              >
                复制当前步骤
              </Button>
              <Button
                type="button"
                variant="outline"
                icon={<Copy size={14} />}
                className="cc-action-btn"
                onClick={() => void copyText(fullTaskCommands)}
                disabled={!fullTaskCommands}
              >
                复制任务命令
              </Button>
              <Button
                type="button"
                variant="outline"
                icon={<Copy size={14} />}
                className="cc-action-btn"
                onClick={() => void copyText(logsText)}
                disabled={!logsText}
              >
                复制日志
              </Button>
              {showRestartAction ? (
                <Button
                  type="button"
                  variant="default"
                  icon={<RefreshCw size={14} />}
                  className="cc-action-btn"
                  onClick={() => void onRestartBackend()}
                  disabled={restartBusy}
                >
                  重启后端
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                icon={<SquareTerminal size={14} />}
                className="cc-action-btn"
                onClick={() => void onCancelTask()}
                disabled={!isBusy}
              >
                取消
              </Button>
            </div>
          </div>
          {failureSummary ? <p className="hint cc-install-error-summary">{failureSummary}</p> : null}
          {restartHint ? <p className="hint">{restartHint}</p> : null}
          <pre ref={consoleRef} className="cc-install-console">
            {logsText || session.message || "No logs yet."}
          </pre>
          {session.fallbackReason ? <p className="hint">{session.fallbackReason}</p> : null}
        </section>
      </section>
    </div>
  );
}
