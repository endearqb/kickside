import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Play, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    case "planned":
      return "已规划";
    case "executing":
      return "执行中";
    default:
      return "暂无";
  }
}

function outcomeClass(value?: ScheduleOutcome | null) {
  if (value === "executed") return "border-[var(--success)] text-[var(--success)]";
  if (value === "blocked_by_permission") return "border-[var(--warning)] text-[var(--warning)]";
  if (value === "failed") return "border-[var(--destructive)] text-[var(--destructive)]";
  return "border-[var(--border)] text-[var(--muted-foreground)]";
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

export function WorkspaceSchedulePanel() {
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
      setWorkspaces(nextWorkspaces);
      setSchedule(nextSchedule);
      const nextWorkspaceId = workspaceId || nextWorkspaces[0]?.id || "";
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

  return (
    <div className="space-y-4 text-[var(--foreground)]">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase text-[var(--muted-foreground)]">
              Schedule
            </p>
            <h2 className="mt-1 text-lg font-semibold">工作区调度</h2>
          </div>
          <Button variant="outline" size="sm" icon={<RefreshCw size={15} />} onClick={() => void refresh()} disabled={busy}>
            刷新
          </Button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(220px,320px)_1fr]">
          <label className="space-y-1 text-sm">
            <span className="font-medium">工作区</span>
            <select
              className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm"
              value={selectedWorkspaceId}
              onChange={(event) => void handleWorkspaceChange(event.currentTarget.value)}
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>
          <div className="rounded-md border border-[var(--border)] p-3">
            <div className="text-sm font-semibold">{selectedWorkspace?.name ?? "未选择工作区"}</div>
            <div className="mt-1 truncate font-mono text-xs text-[var(--muted-foreground)]">
              {selectedWorkspace?.cwd ?? "请先在 WorkspaceHub 注册工作区"}
            </div>
          </div>
        </div>
      </section>

      {selectedWorkspace ? (
        <>
          <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm">
            <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
              <div>
                <h2 className="text-lg font-semibold">只读心跳</h2>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  最近：{formatDate(heartbeat?.lastRunAt)} · 下次：{formatDate(heartbeat?.nextRunAt)}
                </p>
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <label className="space-y-1 text-sm">
                    <span className="font-medium">间隔分钟</span>
                    <Input
                      value={String(heartbeatInterval)}
                      type="number"
                      min={5}
                      max={1440}
                      onChange={(event) => setHeartbeatInterval(Number(event.currentTarget.value) || 30)}
                    />
                  </label>
                  <span className={`rounded-sm border px-2 py-1 text-xs ${outcomeClass(heartbeat?.lastOutcome)}`}>
                    {formatOutcome(heartbeat?.lastOutcome)}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-start gap-2 lg:justify-end">
                <Button
                  variant={heartbeat?.enabled ? "outline" : "default"}
                  onClick={() => void handleSetHeartbeat(!heartbeat?.enabled)}
                  disabled={busy}
                >
                  {heartbeat?.enabled ? "停用" : "启用"}
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
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm">
            <div className="grid gap-4 xl:grid-cols-[minmax(280px,360px)_1fr]">
              <div className="space-y-3 rounded-md border border-[var(--border)] p-3">
                <div className="flex items-center gap-2">
                  <CalendarClock size={16} />
                  <h2 className="text-base font-semibold">新增 plan-then-run</h2>
                </div>
                <label className="space-y-1 text-sm">
                  <span className="font-medium">任务名</span>
                  <Input value={taskName} onChange={(event) => setTaskName(event.currentTarget.value)} />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium">目标</span>
                  <textarea
                    className="min-h-24 w-full resize-y rounded-md border border-[var(--border)] bg-[var(--background)] p-3 text-sm"
                    value={taskPrompt}
                    onChange={(event) => setTaskPrompt(event.currentTarget.value)}
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1 text-sm">
                    <span className="font-medium">频率</span>
                    <select
                      className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm"
                      value={cadenceKind}
                      onChange={(event) => setCadenceKind(event.currentTarget.value as "daily" | "weekday" | "cron")}
                    >
                      <option value="daily">每天</option>
                      <option value="weekday">工作日</option>
                      <option value="cron">Cron</option>
                    </select>
                  </label>
                  {cadenceKind === "cron" ? (
                    <label className="space-y-1 text-sm">
                      <span className="font-medium">表达式</span>
                      <Input value={cronExpression} onChange={(event) => setCronExpression(event.currentTarget.value)} />
                    </label>
                  ) : (
                    <label className="space-y-1 text-sm">
                      <span className="font-medium">时间</span>
                      <Input value={cadenceAt} onChange={(event) => setCadenceAt(event.currentTarget.value)} />
                    </label>
                  )}
                </div>
                <label className="space-y-1 text-sm">
                  <span className="font-medium">执行权限</span>
                  <select
                    className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm"
                    value={permission}
                    onChange={(event) => setPermission(event.currentTarget.value as AcpExecutionPermission)}
                  >
                    <option value="auto">auto</option>
                    <option value="yolo">yolo</option>
                  </select>
                </label>
                {permission === "yolo" ? (
                  <div className="rounded-md border border-[var(--warning)] bg-[var(--warning)]/10 p-2 text-xs">
                    yolo 会允许更高风险的自动执行，请只用于可信工作区。
                  </div>
                ) : null}
                <Button onClick={handleCreateTask} disabled={busy}>
                  创建任务
                </Button>
              </div>

              <div className="space-y-2">
                {tasks.map((task) => (
                  <div key={task.id} className="rounded-md border border-[var(--border)] p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold">{task.name}</h3>
                          <span className={`rounded-sm border px-2 py-1 text-xs ${outcomeClass(task.lastOutcome)}`}>
                            {formatOutcome(task.lastOutcome)}
                          </span>
                          <span className="rounded-sm bg-[var(--muted)] px-2 py-1 text-xs text-[var(--muted-foreground)]">
                            {task.executionPermission}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                          {formatCadence(task.cadence)} · 下次 {formatDate(task.nextRunAt)}
                        </p>
                        <p className="mt-2 line-clamp-2 text-sm">{task.prompt}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          icon={<Play size={15} />}
                          onClick={() => void handleRunTask(task)}
                          disabled={busy}
                        >
                          Run now
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
                  </div>
                ))}
                {tasks.length === 0 ? (
                  <div className="rounded-md border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted-foreground)]">
                    还没有定时任务。
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Run history</h2>
              <span className="text-xs text-[var(--muted-foreground)]">{runs.length} 条</span>
            </div>
            <div className="mt-3 space-y-2">
              {runs.map((run) => (
                <details key={run.id} className="rounded-md border border-[var(--border)] p-3">
                  <summary className="cursor-pointer list-none">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-sm font-semibold">{run.taskName}</span>
                        <span className="ml-2 text-xs text-[var(--muted-foreground)]">
                          {formatDate(run.startedAt)}
                        </span>
                      </div>
                      <span className={`rounded-sm border px-2 py-1 text-xs ${outcomeClass(run.outcome)}`}>
                        {formatOutcome(run.outcome)}
                      </span>
                    </div>
                  </summary>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <h4 className="text-xs font-semibold uppercase text-[var(--muted-foreground)]">Plan</h4>
                      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-[var(--muted)] p-2 text-xs">
                        {run.plan ?? "无"}
                      </pre>
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold uppercase text-[var(--muted-foreground)]">Result</h4>
                      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-[var(--muted)] p-2 text-xs">
                        {run.result ?? run.error ?? "无"}
                      </pre>
                    </div>
                  </div>
                </details>
              ))}
              {runs.length === 0 ? (
                <div className="rounded-md border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted-foreground)]">
                  暂无运行记录。
                </div>
              ) : null}
            </div>
          </section>
        </>
      ) : null}

      {message ? (
        <div className="rounded-md border border-[var(--border)] bg-[var(--muted)] p-3 text-sm">
          {message}
        </div>
      ) : null}
    </div>
  );
}
