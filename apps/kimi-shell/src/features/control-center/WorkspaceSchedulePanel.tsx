import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Play, RefreshCw, Trash2 } from "lucide-react";
import { ControlCenterDescList } from "@/components/control-center/ControlCenterDescList";
import { ControlCenterEmptyState } from "@/components/control-center/ControlCenterEmptyState";
import {
  ControlCenterStatusBadge,
  type ControlCenterStatusTone,
} from "@/components/control-center/ControlCenterStatusBadge";
import { ControlCenterWorkbenchLayout } from "@/components/control-center/ControlCenterWorkbenchLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { UnifiedRailGroup } from "@/features/control-center/ControlCenterUnifiedRail";
import {
  createScheduledTask,
  deleteScheduledTask,
  listRuns,
  listSchedule,
  listWorkspaces,
  runScheduleNow,
  setHeartbeat,
  type AcpExecutionPermission,
  type HeartbeatConfig,
  type RunRecord,
  type ScheduleCadence,
  type ScheduleOutcome,
  type ScheduleStore,
  type ScheduledTask,
  type WorkspaceRecord,
} from "./controlCenterRebuildApi";

type WorkspaceSchedulePanelProps = {
  detailOnly?: boolean;
  activeFocusId?: string | null;
  onRailGroupsChange?: (groups: UnifiedRailGroup[]) => void;
};

function formatDate(value?: string | null) {
  if (!value) return "未计划";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function formatOutcome(value?: ScheduleOutcome | null) {
  switch (value) {
    case "executed":
      return "已执行";
    case "failed":
      return "失败";
    case "skipped":
      return "已跳过";
    case "blocked_by_permission":
      return "权限阻断";
    case "schedule_error":
      return "调度异常";
    case "planned":
      return "已规划";
    case "executing":
      return "执行中";
    default:
      return "暂无";
  }
}

function outcomeTone(value?: ScheduleOutcome | null): ControlCenterStatusTone {
  if (value === "executed") return "success";
  if (value === "blocked_by_permission" || value === "skipped") return "warning";
  if (value === "failed" || value === "schedule_error") return "danger";
  if (value === "executing" || value === "planned") return "accent";
  return "neutral";
}

function formatCadence(cadence: ScheduleCadence) {
  if (cadence.kind === "daily") return `每天 ${cadence.at}`;
  if (cadence.kind === "weekday") return `工作日 ${cadence.at}`;
  return `cron ${cadence.expression}`;
}

function taskCadence(kind: "daily" | "weekday" | "cron", at: string, expression: string): ScheduleCadence {
  if (kind === "cron") return { kind: "cron", expression };
  return { kind, at };
}

function focusDomId(id: string) {
  return `cc-focus-${id}`;
}

export function WorkspaceSchedulePanel({
  detailOnly = false,
  activeFocusId,
  onRailGroupsChange,
}: WorkspaceSchedulePanelProps) {
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [schedule, setSchedule] = useState<ScheduleStore>({ heartbeats: [], tasks: [] });
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [heartbeatInterval, setHeartbeatInterval] = useState(30);
  const [taskName, setTaskName] = useState("每日工作区整理");
  const [taskPrompt, setTaskPrompt] = useState("检查当前工作区的待办、文档和最新变更，按计划执行必要整理。");
  const [cadenceKind, setCadenceKind] = useState<"daily" | "weekday" | "cron">("daily");
  const [cadenceAt, setCadenceAt] = useState("09:30");
  const [cronExpression, setCronExpression] = useState("0 30 9 * * *");
  const [permission, setPermission] = useState<AcpExecutionPermission>("auto");

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
    [selectedWorkspaceId, workspaces],
  );
  const heartbeat = useMemo(
    () =>
      schedule.heartbeats.find((item) => item.workspaceId === selectedWorkspaceId) ??
      null,
    [schedule.heartbeats, selectedWorkspaceId],
  );
  const tasks = useMemo(
    () => schedule.tasks.filter((task) => task.workspaceId === selectedWorkspaceId),
    [schedule.tasks, selectedWorkspaceId],
  );

  async function refresh(workspaceId = selectedWorkspaceId) {
    setBusy(true);
    setMessage(null);
    try {
      const [nextWorkspaces, nextSchedule] = await Promise.all([listWorkspaces(), listSchedule()]);
      const nextWorkspaceId = workspaceId || nextWorkspaces[0]?.id || "";
      setWorkspaces(nextWorkspaces);
      setSchedule(nextSchedule);
      setSelectedWorkspaceId(nextWorkspaceId);
      setRuns(nextWorkspaceId ? await listRuns(nextWorkspaceId, 25) : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleWorkspaceChange(workspaceId: string) {
    setSelectedWorkspaceId(workspaceId);
    setRuns(workspaceId ? await listRuns(workspaceId, 25) : []);
  }

  async function handleSetHeartbeat(enabled: boolean) {
    if (!selectedWorkspaceId) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await setHeartbeat({
        workspaceId: selectedWorkspaceId,
        enabled,
        intervalMinutes: heartbeatInterval,
      });
      setHeartbeatInterval(result.intervalMinutes);
      await refresh(selectedWorkspaceId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleRunHeartbeat(target: HeartbeatConfig | null) {
    if (!target) {
      await handleSetHeartbeat(true);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await runScheduleNow("heartbeat", target.id);
      await refresh(selectedWorkspaceId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateTask() {
    if (!selectedWorkspaceId) return;
    setBusy(true);
    setMessage(null);
    try {
      await createScheduledTask({
        workspaceId: selectedWorkspaceId,
        name: taskName,
        prompt: taskPrompt,
        cadence: taskCadence(cadenceKind, cadenceAt, cronExpression),
        enabled: true,
        executionPermission: permission,
        maxRunMinutes: 20,
      });
      await refresh(selectedWorkspaceId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleRunTask(task: ScheduledTask) {
    setBusy(true);
    setMessage(null);
    try {
      await runScheduleNow("task", task.id);
      await refresh(selectedWorkspaceId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteTask(task: ScheduledTask) {
    setBusy(true);
    setMessage(null);
    try {
      await deleteScheduledTask(task.id);
      await refresh(selectedWorkspaceId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const railGroups = useMemo<UnifiedRailGroup[]>(
    () => [
      {
        id: "schedule:workspaces",
        label: "调度工作区",
        count: workspaces.length,
        collapsible: true,
        items: workspaces.map((workspace) => {
          const itemHeartbeat =
            schedule.heartbeats.find((item) => item.workspaceId === workspace.id) ?? null;
          const itemTasks = schedule.tasks.filter((task) => task.workspaceId === workspace.id);
          return {
            id: `schedule:${workspace.id}`,
            label: workspace.name,
            meta: `${itemTasks.length} 任务`,
            statusLabel: itemHeartbeat?.enabled ? "ready" : "idle",
            statusTone: itemHeartbeat?.enabled ? ("success" as const) : ("neutral" as const),
            active: workspace.id === selectedWorkspaceId,
            onSelect: () => void handleWorkspaceChange(workspace.id),
          };
        }),
      },
    ],
    [schedule.heartbeats, schedule.tasks, selectedWorkspaceId, workspaces],
  );

  useEffect(() => {
    onRailGroupsChange?.(railGroups);
  }, [onRailGroupsChange, railGroups]);

  if (workspaces.length === 0) {
    return (
      <section className={`workspace-schedule-panel ${detailOnly ? "cc-image-detail-page workspace-schedule-panel-detail-only" : "cc-control-stack"}`}>
        {detailOnly ? (
          <div
            id={focusDomId("schedule")}
            className={`cc-image-detail-top ${activeFocusId === "schedule" ? "is-focus" : ""}`}
          >
            <div>
              <h1>调度</h1>
              <p>以 workspace 为对象管理心跳、plan-then-run 任务和运行记录。</p>
            </div>
          </div>
        ) : null}
        <ControlCenterEmptyState
          title="还没有可调度的工作区"
          description="先到 WorkspaceHub 创建或注册工作区。"
          icon={<CalendarClock size={18} />}
          action={
            <Button
              variant="outline"
              icon={<RefreshCw size={15} />}
              onClick={() => void refresh()}
              disabled={busy}
            >
              刷新
            </Button>
          }
        />
        {message ? (
          <div className="cc-control-detail-item" role="alert">
            {message}
          </div>
        ) : null}
      </section>
    );
  }

  const rail = (
    <div className="cc-control-list" aria-label="调度工作区列表">
      <div className="cc-control-group-label">工作区</div>
      {workspaces.map((workspace) => {
        const itemHeartbeat =
          schedule.heartbeats.find((item) => item.workspaceId === workspace.id) ?? null;
        const itemTasks = schedule.tasks.filter((task) => task.workspaceId === workspace.id);
        const selected = workspace.id === selectedWorkspaceId;
        return (
          <button
            key={workspace.id}
            type="button"
            className={`cc-control-list-item ${selected ? "is-active" : ""}`}
            onClick={() => void handleWorkspaceChange(workspace.id)}
            aria-current={selected ? "true" : undefined}
          >
            <span className="cc-control-list-item-header">
              <span className="cc-control-list-item-copy">
                <strong>{workspace.name}</strong>
                <small>{workspace.cwd}</small>
              </span>
              <ControlCenterStatusBadge
                tone={itemHeartbeat?.enabled ? "success" : "neutral"}
              >
                {itemHeartbeat?.enabled ? "运行中" : "已停止"}
              </ControlCenterStatusBadge>
            </span>
            <span className="cc-control-list-item-meta">
              <span>{itemTasks.length} 个任务</span>
              <span>{formatOutcome(itemHeartbeat?.lastOutcome)}</span>
            </span>
          </button>
        );
      })}
      {workspaces.length === 0 ? (
        <ControlCenterEmptyState
          title="没有工作区"
          description="先在 WorkspaceHub 注册或创建工作区。"
          icon={<CalendarClock size={18} />}
        />
      ) : null}
    </div>
  );

  const detail = selectedWorkspace ? (
    <div className="cc-control-detail-stack">
      <div className="cc-control-detail-head">
        <div className="cc-control-detail-copy">
          <h3>{selectedWorkspace.name}</h3>
          <p>{selectedWorkspace.cwd}</p>
          <div className="cc-control-chip-row">
            <ControlCenterStatusBadge tone={heartbeat?.enabled ? "success" : "neutral"}>
              {heartbeat?.enabled ? "心跳已启用" : "心跳未启用"}
            </ControlCenterStatusBadge>
          </div>
        </div>
        <div className="cc-control-action-row">
          <Button
            variant={heartbeat?.enabled ? "outline" : "default"}
            onClick={() => void handleSetHeartbeat(!heartbeat?.enabled)}
            disabled={busy}
          >
            {heartbeat?.enabled ? "停用心跳" : "启用心跳"}
          </Button>
          <Button
            variant="ghost"
            icon={<Play size={15} />}
            onClick={() => void handleRunHeartbeat(heartbeat)}
            disabled={busy}
          >
            立即心跳
          </Button>
        </div>
      </div>

      <ControlCenterDescList
        columns={4}
        items={[
          {
            label: "心跳间隔",
            value: `${heartbeat?.intervalMinutes ?? heartbeatInterval} 分钟`,
            meta: heartbeat?.enabled ? "已启用" : "已停用",
          },
          { label: "上次运行", value: formatDate(heartbeat?.lastRunAt) },
          { label: "下次运行", value: formatDate(heartbeat?.nextRunAt) },
          { label: "最近结果", value: formatOutcome(heartbeat?.lastOutcome) },
        ]}
      />

      <section className="cc-surface-section">
        <header className="cc-surface-section-header">
          <div className="cc-surface-section-copy">
            <h4>只读心跳</h4>
            <p>定时检查工作区状态。修改间隔后，启用或停用心跳会保存配置。</p>
          </div>
          <ControlCenterStatusBadge tone={heartbeat?.enabled ? "success" : "neutral"}>
            {heartbeat?.enabled ? "运行中" : "已停止"}
          </ControlCenterStatusBadge>
        </header>
        <div className="cc-surface-section-body">
          <label className="cc-control-field">
            <span>间隔分钟</span>
            <Input
              value={String(heartbeatInterval)}
              type="number"
              min={5}
              max={1440}
              onChange={(event) => setHeartbeatInterval(Number(event.currentTarget.value) || 30)}
            />
          </label>
        </div>
      </section>

      <section className="cc-surface-section">
        <header className="cc-surface-section-header">
          <div className="cc-surface-section-copy">
            <h4>新增计划任务</h4>
            <p>任务会先生成计划，再按权限执行。</p>
          </div>
          <Button icon={<CalendarClock size={15} />} onClick={handleCreateTask} disabled={busy}>
            创建任务
          </Button>
        </header>
        <div className="cc-surface-section-body">
          <div className="cc-control-detail-grid">
            <label className="cc-control-field">
              <span>任务名</span>
              <Input value={taskName} onChange={(event) => setTaskName(event.currentTarget.value)} />
            </label>
            <label className="cc-control-field">
              <span>频率</span>
              <select
                className="cc-control-select"
                value={cadenceKind}
                onChange={(event) => setCadenceKind(event.currentTarget.value as "daily" | "weekday" | "cron")}
              >
                <option value="daily">每天</option>
                <option value="weekday">工作日</option>
                <option value="cron">Cron</option>
              </select>
            </label>
            {cadenceKind === "cron" ? (
              <label className="cc-control-field">
                <span>表达式</span>
                <Input value={cronExpression} onChange={(event) => setCronExpression(event.currentTarget.value)} />
              </label>
            ) : (
              <label className="cc-control-field">
                <span>时间</span>
                <Input value={cadenceAt} onChange={(event) => setCadenceAt(event.currentTarget.value)} />
              </label>
            )}
            <label className="cc-control-field">
              <span>执行权限</span>
              <select
                className="cc-control-select"
                value={permission}
                onChange={(event) => setPermission(event.currentTarget.value as AcpExecutionPermission)}
              >
                <option value="auto">auto</option>
                <option value="yolo">yolo</option>
              </select>
            </label>
          </div>
          <label className="cc-control-field">
            <span>目标</span>
            <textarea
              className="cc-control-textarea"
              value={taskPrompt}
              onChange={(event) => setTaskPrompt(event.currentTarget.value)}
            />
          </label>
          {permission === "yolo" ? (
            <div className="cc-control-detail-item" role="alert">
              yolo 允许更高风险自动执行，仅用于可信工作区。
            </div>
          ) : (
            <div className="cc-control-muted">
              auto 会自动执行安全操作，遇到权限阻断则停止。
            </div>
          )}
        </div>
      </section>

      <section className="cc-surface-section">
        <header className="cc-surface-section-header">
          <div className="cc-surface-section-copy">
            <h4>任务列表</h4>
            <p>{tasks.length} 个任务绑定到当前工作区。</p>
          </div>
        </header>
        <div className="cc-surface-section-body">
          <div className="cc-control-detail-list">
            {tasks.map((task) => (
              <div key={task.id} className="cc-control-detail-item">
                <div className="cc-control-detail-head">
                  <div className="cc-control-detail-copy">
                    <h3>{task.name}</h3>
                    <p>{formatCadence(task.cadence)} · 下次 {formatDate(task.nextRunAt)}</p>
                    <div className="cc-control-chip-row">
                      <ControlCenterStatusBadge tone={outcomeTone(task.lastOutcome)}>
                        {formatOutcome(task.lastOutcome)}
                      </ControlCenterStatusBadge>
                      <ControlCenterStatusBadge
                        tone={task.executionPermission === "yolo" ? "warning" : "neutral"}
                      >
                        {task.executionPermission}
                      </ControlCenterStatusBadge>
                    </div>
                  </div>
                  <div className="cc-control-action-row">
                    <Button
                      variant="outline"
                      size="sm"
                      icon={<Play size={15} />}
                      onClick={() => void handleRunTask(task)}
                      disabled={busy}
                    >
                      立即运行
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      icon={<Trash2 size={15} />}
                      aria-label="删除任务"
                      onClick={() => void handleDeleteTask(task)}
                      disabled={busy}
                    />
                  </div>
                </div>
                <p className="cc-control-muted">{task.prompt}</p>
              </div>
            ))}
          </div>
          {tasks.length === 0 ? (
            <ControlCenterEmptyState
              title="还没有定时任务"
              description="创建一个 plan-then-run 任务后会显示在这里。"
              icon={<CalendarClock size={18} />}
            />
          ) : null}
        </div>
      </section>

      <section className="cc-surface-section">
        <header className="cc-surface-section-header">
          <div className="cc-surface-section-copy">
            <h4>运行记录</h4>
            <p>{runs.length} 条最近运行记录，计划和结果默认折叠。</p>
          </div>
        </header>
        <div className="cc-surface-section-body">
          <div className="cc-control-detail-list">
            {runs.map((run) => (
              <details key={run.id} className="cc-control-detail-item">
                <summary className="cc-run-summary">
                  <span>
                    <strong>{run.taskName}</strong>
                    <small>{formatDate(run.startedAt)}</small>
                  </span>
                  <ControlCenterStatusBadge tone={outcomeTone(run.outcome)}>
                    {formatOutcome(run.outcome)}
                  </ControlCenterStatusBadge>
                </summary>
                <div className="cc-run-detail-grid">
                  <div>
                    <h4>计划</h4>
                    <pre className="cc-code-preview">{run.plan ?? "无"}</pre>
                  </div>
                  <div>
                    <h4>结果</h4>
                    <pre className="cc-code-preview">{run.result ?? run.error ?? "无"}</pre>
                  </div>
                </div>
              </details>
            ))}
          </div>
          {runs.length === 0 ? (
            <ControlCenterEmptyState
              title="暂无运行记录"
              description="手动运行心跳或任务后会在这里出现。"
              icon={<Play size={18} />}
            />
          ) : null}
        </div>
      </section>
    </div>
  ) : null;

  if (detailOnly) {
    return (
      <section className="cc-image-detail-page workspace-schedule-panel workspace-schedule-panel-detail-only">
        <div
          id={focusDomId("schedule")}
          className={`cc-image-detail-top ${activeFocusId === "schedule" ? "is-focus" : ""}`}
        >
          <div>
            <h1>调度</h1>
            <p>以 workspace 为对象管理心跳、plan-then-run 任务和运行记录。</p>
          </div>
          <div className="cc-image-top-controls">
            <Button variant="outline" icon={<RefreshCw size={15} />} onClick={() => void refresh()} disabled={busy}>
              刷新
            </Button>
          </div>
        </div>

        <ControlCenterDescList
          columns={4}
          className="cc-image-meta-grid"
          items={[
            { label: "Workspaces", value: String(workspaces.length) },
            { label: "Heartbeat", value: heartbeat?.enabled ? "enabled" : "disabled" },
            { label: "Tasks", value: String(tasks.length) },
            { label: "Last outcome", value: formatOutcome(heartbeat?.lastOutcome) },
          ]}
        />

        <section className="cc-image-card">
          <h2>调度工作区</h2>
          <ul className="cc-image-row-list">
            {workspaces.map((workspace) => {
              const itemHeartbeat =
                schedule.heartbeats.find((item) => item.workspaceId === workspace.id) ?? null;
              const itemTasks = schedule.tasks.filter((task) => task.workspaceId === workspace.id);
              const itemId = `schedule:${workspace.id}`;
              return (
                <li
                  key={workspace.id}
                  id={focusDomId(itemId)}
                  className={`cc-image-row ${activeFocusId === itemId ? "is-focus" : ""}`}
                >
                  <div>
                    <div className="cc-image-row-title">
                      <span className={`cc-dot ${itemHeartbeat?.enabled ? "success" : "neutral"}`} />
                      {workspace.name}
                    </div>
                    <div className="cc-image-row-desc">{workspace.cwd}</div>
                  </div>
                  <div className="cc-image-row-actions">
                    <ControlCenterStatusBadge tone={itemHeartbeat?.enabled ? "success" : "neutral"}>
                      {itemHeartbeat?.enabled ? "运行中" : "已停止"}
                    </ControlCenterStatusBadge>
                    <span className="cc-image-muted">{itemTasks.length} 任务</span>
                    <Button type="button" variant="outline" className="cc-action-btn" onClick={() => void handleWorkspaceChange(workspace.id)}>
                      查看调度
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="cc-image-card">
          <h2>{selectedWorkspace?.name ?? "调度详情"}</h2>
          {detail ?? (
            <ControlCenterEmptyState
              title="选择工作区"
              description="从左侧选择工作区以查看调度详情。"
              icon={<CalendarClock size={18} />}
            />
          )}
        </section>
        {message ? (
          <div className="cc-control-detail-item" role="alert">
            {message}
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <div className="cc-control-stack workspace-schedule-panel">
      <ControlCenterWorkbenchLayout
        mode="stack-on-mobile"
        className="workspace-schedule-workbench"
        railHeader={
          <div className="cc-control-toolbar">
            <div className="cc-control-detail-head">
              <div className="cc-control-detail-copy">
                <h3>调度</h3>
              </div>
              <Button
                variant="outline"
                size="icon-sm"
                icon={<RefreshCw size={15} />}
                onClick={() => void refresh()}
                disabled={busy}
                aria-label="刷新调度"
              />
            </div>
          </div>
        }
        rail={rail}
        detail={detail}
        emptyDetail={
          <ControlCenterEmptyState
            title="选择工作区"
            description="从左侧选择工作区以查看调度详情。"
            icon={<CalendarClock size={18} />}
          />
        }
      />
      {message ? (
        <div className="cc-control-detail-item" role="alert">
          {message}
        </div>
      ) : null}
    </div>
  );
}
