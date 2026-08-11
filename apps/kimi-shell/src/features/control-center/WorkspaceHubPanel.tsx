import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Boxes,
  CalendarClock,
  ChevronLeft,
  FolderOpen,
  Play,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import type { WorkspaceSkillTarget } from "@/app/types";
import { ControlCenterDescList } from "@/components/control-center/ControlCenterDescList";
import { ControlCenterActionMenu } from "@/components/control-center/ControlCenterActionMenu";
import { ControlCenterEmptyState } from "@/components/control-center/ControlCenterEmptyState";
import { ControlCenterStatusBadge } from "@/components/control-center/ControlCenterStatusBadge";
import { ControlCenterWorkbenchLayout } from "@/components/control-center/ControlCenterWorkbenchLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { UnifiedRailGroup } from "@/features/control-center/ControlCenterUnifiedRail";
import { DirectoryCardGrid } from "@/features/directory/DirectoryCardGrid";
import { DirectoryFilePreview } from "@/features/directory/DirectoryFilePreview";
import {
  createHarnessWorkspace,
  dryRunHarness,
  listHarnessFileEntries,
  listHarnesses,
  listWorkspaces,
  listWorkspaceFileEntries,
  markWorkspaceOpened,
  readHarnessFile,
  readWorkspaceFile,
  type HarnessDryRunResult,
  type HarnessManifest,
  type ScheduleStore,
  type WorkspaceRecord,
} from "./controlCenterRebuildApi";

type WorkspaceHubPanelProps = {
  onOpenWorkspace: (path: string) => Promise<void>;
  onOpenSchedule?: () => void;
  onOpenSkill?: (skillId: string) => void;
  focusWorkspacePath?: string | null;
  detailOnly?: boolean;
  activeFocusId?: string | null;
  onRailGroupsChange?: (groups: UnifiedRailGroup[]) => void;
};

type WorkspaceHubDirectoryType = "all" | "harness" | "workspace";

type WorkspaceHubDirectoryFilter =
  | "all"
  | "kimi_code"
  | "hermes"
  | "other_runtime"
  | "recent"
  | "harness_source"
  | "manual";

type WorkspaceHubSortKey = "name" | "runtime" | "recent" | "source";

function formatRuntime(value: string) {
  if (value === "kimi-code") return "Kimi Code";
  if (value === "hermes") return "Hermes";
  return "Other";
}

function formatDate(value?: string | null) {
  if (!value) return "未记录";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function valueFrom(values: Record<string, string>, key: string) {
  return values[key] ?? "";
}

function matchesDirectoryQuery(query: string, values: Array<string | undefined | null>) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return values.some((value) => value?.toLowerCase().includes(normalized));
}

function workspaceDirectoryName(workspace: WorkspaceRecord) {
  return workspace.name || workspace.cwd.replace(/\\/g, "/").split("/").filter(Boolean).pop() || workspace.cwd;
}

export function matchesWorkspaceDirectoryFilters(
  workspace: WorkspaceRecord,
  type: WorkspaceHubDirectoryType,
  filter: WorkspaceHubDirectoryFilter,
) {
  if (type === "harness") return false;
  if (filter === "kimi_code") return workspace.agentRuntime === "kimi-code";
  if (filter === "hermes") return workspace.agentRuntime === "hermes";
  if (filter === "other_runtime") return workspace.agentRuntime === "other";
  if (filter === "recent") return Boolean(workspace.lastOpenedAt);
  if (filter === "harness_source") return workspace.source === "harness" || Boolean(workspace.harnessId);
  if (filter === "manual") return workspace.source === "manual";
  return true;
}

export function normalizeWorkspacePathKey(value?: string | null) {
  return (value ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function shouldBackToWorkspaceDirectory(key: string, hasDirectoryDetail: boolean) {
  return key === "Escape" && hasDirectoryDetail;
}

export function findWorkspaceTargetForRecord(
  workspace: WorkspaceRecord | null,
  targets: WorkspaceSkillTarget[],
) {
  if (!workspace) return null;
  const workspacePathKey = normalizeWorkspacePathKey(workspace.cwd);
  return (
    targets.find(
      (target) =>
        target.scope === "workspace" &&
        normalizeWorkspacePathKey(target.rootPath) === workspacePathKey,
    ) ??
    targets.find(
      (target) =>
        target.scope === "workspace" &&
        normalizeWorkspacePathKey(target.id.replace(/^workspace:/, "")) === workspacePathKey,
    ) ??
    null
  );
}

export function findWorkspaceRecordByPath(
  workspaces: WorkspaceRecord[],
  path?: string | null,
) {
  const targetPathKey = normalizeWorkspacePathKey(path);
  if (!targetPathKey) return null;
  return (
    workspaces.find(
      (workspace) => normalizeWorkspacePathKey(workspace.cwd) === targetPathKey,
    ) ?? null
  );
}

export function summarizeWorkspaceSchedule(store: ScheduleStore | null, workspaceId: string) {
  const heartbeat =
    store?.heartbeats.find((item) => item.workspaceId === workspaceId) ?? null;
  const tasks = store?.tasks.filter((task) => task.workspaceId === workspaceId) ?? [];
  const nextRunAt =
    [heartbeat?.nextRunAt, ...tasks.map((task) => task.nextRunAt)]
      .filter((value): value is string => Boolean(value))
      .sort()[0] ?? null;

  return {
    heartbeat,
    tasks,
    enabledTaskCount: tasks.filter((task) => task.enabled).length,
    nextRunAt,
  };
}

function makeHarnessItemId(id: string) {
  return `harness:${id}`;
}

function makeWorkspaceItemId(id: string) {
  return `workspace:${id}`;
}

function focusDomId(id: string) {
  return `cc-focus-${id}`;
}

export function WorkspaceHubPanel({
  onOpenWorkspace,
  onOpenSchedule,
  focusWorkspacePath,
  detailOnly = false,
  activeFocusId,
  onRailGroupsChange,
}: WorkspaceHubPanelProps) {
  const [harnesses, setHarnesses] = useState<HarnessManifest[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [dryRun, setDryRun] = useState<HarnessDryRunResult | null>(null);
  const [createdWorkspace, setCreatedWorkspace] = useState<WorkspaceRecord | null>(null);
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [directoryFilter, setDirectoryFilter] = useState<WorkspaceHubDirectoryFilter>("all");
  const [directorySort, setDirectorySort] = useState<WorkspaceHubSortKey>("name");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selectedKind = selectedItemId.startsWith("workspace:") ? "workspace" : "harness";
  const selectedHarnessId =
    selectedKind === "harness" ? selectedItemId.replace(/^harness:/, "") : "";
  const selectedWorkspaceId =
    selectedKind === "workspace" ? selectedItemId.replace(/^workspace:/, "") : "";

  const selectedHarness = useMemo(
    () => harnesses.find((harness) => harness.id === selectedHarnessId) ?? null,
    [harnesses, selectedHarnessId],
  );
  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
    [workspaces, selectedWorkspaceId],
  );
  const hasDirectoryDetail = Boolean(selectedHarness || selectedWorkspace);
  const loadSelectedHarnessFileEntries = useCallback(
    () =>
      selectedHarnessId
        ? listHarnessFileEntries(selectedHarnessId)
        : Promise.resolve([]),
    [selectedHarnessId],
  );
  const readSelectedHarnessFile = useCallback(
    (relPath: string) => {
      if (!selectedHarnessId) {
        return Promise.reject(new Error("missing selected harness"));
      }
      return readHarnessFile(selectedHarnessId, relPath);
    },
    [selectedHarnessId],
  );
  const loadSelectedWorkspaceFileEntries = useCallback(
    () =>
      selectedWorkspaceId
        ? listWorkspaceFileEntries(selectedWorkspaceId)
        : Promise.resolve([]),
    [selectedWorkspaceId],
  );
  const readSelectedWorkspaceFile = useCallback(
    (relPath: string) => {
      if (!selectedWorkspaceId) {
        return Promise.reject(new Error("missing selected workspace"));
      }
      return readWorkspaceFile(selectedWorkspaceId, relPath);
    },
    [selectedWorkspaceId],
  );

  async function refresh() {
    setBusy(true);
    setMessage(null);
    try {
      const [nextHarnesses, nextWorkspaces] = await Promise.all([
        listHarnesses(),
        listWorkspaces(),
      ]);
      setHarnesses(nextHarnesses);
      setWorkspaces(nextWorkspaces);
      setSelectedItemId((current) => {
        if (!current) return "";
        if (
          current.startsWith("harness:") &&
          nextHarnesses.some((harness) => makeHarnessItemId(harness.id) === current)
        ) {
          return current;
        }
        if (
          current.startsWith("workspace:") &&
          nextWorkspaces.some((workspace) => makeWorkspaceItemId(workspace.id) === current)
        ) {
          return current;
        }
        return nextHarnesses[0]
          ? makeHarnessItemId(nextHarnesses[0].id)
          : nextWorkspaces[0]
            ? makeWorkspaceItemId(nextWorkspaces[0].id)
            : "";
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const handleBackToDirectory = useCallback(() => {
    setSelectedItemId("");
  }, []);

  const handleWorkspaceHubKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (shouldBackToWorkspaceDirectory(event.key, hasDirectoryDetail)) {
        event.preventDefault();
        handleBackToDirectory();
      }
    },
    [handleBackToDirectory, hasDirectoryDetail],
  );

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const focusedWorkspace = findWorkspaceRecordByPath(workspaces, focusWorkspacePath);
    if (focusedWorkspace) {
      setSelectedItemId(makeWorkspaceItemId(focusedWorkspace.id));
    }
  }, [focusWorkspacePath, workspaces]);

  useEffect(() => {
    if (!selectedHarness) return;
    setDryRun(null);
    setCreatedWorkspace(null);
    setValues((current) => {
      const next = { ...current };
      for (const variable of selectedHarness.variables) {
        if (variable.key === "workspaceName" && !next[variable.key]) {
          next[variable.key] = selectedHarness.name;
        }
      }
      return next;
    });
  }, [selectedHarness]);

  async function handleDryRun() {
    if (!selectedHarness) return;
    setBusy(true);
    setMessage(null);
    setDryRun(null);
    try {
      setDryRun(await dryRunHarness(selectedHarness.id, values));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    if (!selectedHarness) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await createHarnessWorkspace(selectedHarness.id, values);
      const nextWorkspaces = await listWorkspaces();
      setCreatedWorkspace(result.workspace);
      setMessage(`已创建 ${result.workspace.name}，写入 ${result.fileCount} 个文件。`);
      setDryRun(null);
      setWorkspaces(nextWorkspaces);
      setSelectedItemId(makeWorkspaceItemId(result.workspace.id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handlePickHarnessPath(variableKey: string) {
    setMessage(null);
    try {
      const selected = await open({
        title: "选择目标目录",
        multiple: false,
        directory: true,
      });
      if (typeof selected === "string") {
        setValues((current) => ({
          ...current,
          [variableKey]: selected,
        }));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleOpenHarnessPath(variableKey: string) {
    const path = valueFrom(values, variableKey).trim();
    if (!path) return;
    setMessage(null);
    try {
      await onOpenWorkspace(path);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleOpenWorkspace(workspace: WorkspaceRecord) {
    setBusy(true);
    setMessage(null);
    try {
      await markWorkspaceOpened(workspace.id);
      await onOpenWorkspace(workspace.cwd);
      setWorkspaces(await listWorkspaces());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const directoryCards = useMemo(() => {
    const harnessCards = harnesses
      .filter(() => directoryFilter === "all")
      .filter((harness) =>
        matchesDirectoryQuery(directoryQuery, [
          harness.id,
          harness.name,
          harness.summary,
          harness.version,
          harness.agentRuntime,
          ...harness.tags,
          ...harness.skills.map((skill) => skill.id),
        ]),
      )
      .map((harness) => {
        const itemId = makeHarnessItemId(harness.id);
        return {
          id: itemId,
          title: `/${harness.id}`,
          subtitle: harness.name,
          meta: `v${harness.version} · ${formatRuntime(harness.agentRuntime)}`,
          description: harness.summary,
          active: itemId === selectedItemId,
          badges: [
            { label: "Harness", tone: "neutral" as const },
            { label: `${harness.skills.length} 技能`, tone: "accent" as const },
          ],
          cornerAction: {
            label: "查看模板",
            icon: "+",
            onSelect: () => setSelectedItemId(itemId),
          },
          onOpen: () => setSelectedItemId(itemId),
          sortName: harness.id,
          sortRuntime: harness.agentRuntime,
          sortRecent: "",
          sortSource: "harness",
        };
      });

    const workspaceCards = workspaces
      .filter((workspace) =>
        matchesWorkspaceDirectoryFilters(workspace, "all", directoryFilter),
      )
      .filter((workspace) =>
        matchesDirectoryQuery(directoryQuery, [
          workspace.name,
          workspace.cwd,
          workspace.harnessId,
          workspace.agentRuntime,
          workspace.source,
          ...workspace.tags,
        ]),
      )
      .map((workspace) => {
        const itemId = makeWorkspaceItemId(workspace.id);
        return {
          id: itemId,
          title: workspaceDirectoryName(workspace),
          subtitle: workspace.cwd,
          meta: `${formatRuntime(workspace.agentRuntime)} · 最近打开 ${formatDate(workspace.lastOpenedAt)}`,
          description: workspace.cwd,
          active: itemId === selectedItemId,
          badges: [
            { label: "已注册", tone: "success" as const },
            { label: workspace.source === "harness" ? "Harness 来源" : workspace.source, tone: "neutral" as const },
          ],
          cornerSlot: (
            <ControlCenterActionMenu
              label={`${workspace.name} 操作`}
              disabled={busy}
              items={[
                { label: "查看详情", onSelect: () => setSelectedItemId(itemId) },
                { label: "打开工作区", onSelect: () => void handleOpenWorkspace(workspace) },
                { label: "显示目录", onSelect: () => void onOpenWorkspace(workspace.cwd) },
              ]}
            />
          ),
          onOpen: () => setSelectedItemId(itemId),
          sortName: workspaceDirectoryName(workspace),
          sortRuntime: workspace.agentRuntime,
          sortRecent: workspace.lastOpenedAt ?? "",
          sortSource: workspace.source,
        };
      });

    const cards = [...harnessCards, ...workspaceCards];
    cards.sort((left, right) => {
      if (directorySort === "runtime") return left.sortRuntime.localeCompare(right.sortRuntime);
      if (directorySort === "recent") return right.sortRecent.localeCompare(left.sortRecent);
      if (directorySort === "source") return left.sortSource.localeCompare(right.sortSource);
      return left.sortName.localeCompare(right.sortName);
    });
    return cards;
  }, [busy, directoryFilter, directoryQuery, directorySort, harnesses, onOpenWorkspace, selectedItemId, workspaces]);

  const rail = (
    <div className="cc-control-list" aria-label="WorkspaceHub 对象列表">
      <div className="cc-control-group-label">Harness 模板</div>
      {harnesses.map((harness) => {
        const itemId = makeHarnessItemId(harness.id);
        const selected = itemId === selectedItemId;
        return (
          <button
            key={harness.id}
            type="button"
            className={`cc-control-list-item ${selected ? "is-active" : ""}`}
            onClick={() => setSelectedItemId(itemId)}
            aria-current={selected ? "true" : undefined}
          >
            <span className="cc-control-list-item-header">
              <span className="cc-control-list-item-copy">
                <strong>{harness.name}</strong>
              </span>
              <span className="cc-rail-count">v{harness.version}</span>
            </span>
          </button>
        );
      })}
      {harnesses.length === 0 ? (
        <ControlCenterEmptyState
          title="未找到 harness"
          description="内置模板加载后会显示在这里。"
          icon={<Boxes size={18} />}
        />
      ) : null}

      <div className="cc-control-group-label">已注册工作区</div>
      {workspaces.map((workspace) => {
        const itemId = makeWorkspaceItemId(workspace.id);
        const selected = itemId === selectedItemId;
        return (
          <button
            key={workspace.id}
            type="button"
            className={`cc-control-list-item ${selected ? "is-active" : ""}`}
            onClick={() => setSelectedItemId(itemId)}
            aria-current={selected ? "true" : undefined}
          >
            <span className="cc-control-list-item-header">
              <span className="cc-control-list-item-copy">
                <strong>{workspace.name}</strong>
              </span>
              <ControlCenterStatusBadge tone="success">已注册</ControlCenterStatusBadge>
            </span>
          </button>
        );
      })}
      {workspaces.length === 0 ? (
        <div className="cc-control-muted">还没有注册工作区。</div>
      ) : null}
    </div>
  );

  const harnessDetail = selectedHarness ? (
    <div className="cc-control-detail-stack">
      <div className="cc-control-detail-head">
        <div className="cc-control-detail-copy">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={<ChevronLeft size={14} />}
            onClick={handleBackToDirectory}
          >
            返回
          </Button>
          <h3>{selectedHarness.name}</h3>
        </div>
        <div className="cc-control-action-row">
          <Button
            variant="outline"
            icon={<Search size={15} />}
            onClick={handleDryRun}
            disabled={busy}
          >
            预览文件
          </Button>
          <Button icon={<Sparkles size={15} />} onClick={handleCreate} disabled={busy}>
            创建工作区
          </Button>
        </div>
      </div>

      <ControlCenterDescList
        columns={4}
        items={[
          { label: "变量", value: `${selectedHarness.variables.length} 个` },
          { label: "技能", value: `${selectedHarness.skills.length} 个` },
          { label: "模板", value: selectedHarness.template },
          { label: "创建后动作", value: selectedHarness.postCreate.openWith ?? "无自动打开" },
        ]}
      />

      <div className="cc-control-description">
        <span>描述</span>
        <p>{selectedHarness.summary}</p>
      </div>

      {selectedHarness.tags.length > 0 ? (
        <div className="cc-control-chip-row">
          {selectedHarness.tags.map((tag) => (
            <ControlCenterStatusBadge key={tag} tone="neutral">
              {tag}
            </ControlCenterStatusBadge>
          ))}
        </div>
      ) : null}

      <DirectoryFilePreview
        entityKey={`harness:${selectedHarness.id}`}
        description={selectedHarness.summary}
        loadEntries={loadSelectedHarnessFileEntries}
        readFile={readSelectedHarnessFile}
      />

      <section className="cc-surface-section">
        <header className="cc-surface-section-header">
          <div className="cc-surface-section-copy">
            <h4>变量</h4>
            <p>Secret 字段不会在预览中插值。</p>
          </div>
        </header>
        <div className="cc-surface-section-body">
          <div className="cc-control-detail-grid">
            {selectedHarness.variables.map((variable) => {
              const inputId = `workspace-hub-${selectedHarness.id}-${variable.key}`;
              const input = (
                <Input
                  id={inputId}
                  value={valueFrom(values, variable.key)}
                  placeholder={variable.placeholder ?? ""}
                  type={variable.secret ? "password" : "text"}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [variable.key]: event.currentTarget.value,
                    }))
                  }
                />
              );

              return (
                <div key={variable.key} className="cc-control-field">
                  <label htmlFor={inputId}>
                    {variable.label}
                    {variable.required ? " *" : ""}
                  </label>
                  {variable.type === "path" ? (
                    <div className="workspace-hub-path-row">
                      {input}
                      <Button
                        type="button"
                        variant="outline"
                        className="cc-action-btn cc-inline-btn"
                        onClick={() => void handlePickHarnessPath(variable.key)}
                        disabled={busy}
                      >
                        浏览
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        icon={<FolderOpen size={14} />}
                        className="cc-inline-icon-btn"
                        onClick={() => void handleOpenHarnessPath(variable.key)}
                        disabled={busy || !valueFrom(values, variable.key).trim()}
                        aria-label="打开目标目录"
                        title="打开目标目录"
                      />
                    </div>
                  ) : (
                    input
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {dryRun ? (
        <section className="cc-surface-section">
          <header className="cc-surface-section-header">
            <div className="cc-surface-section-copy">
              <h4>预览文件树</h4>
              <p>{dryRun.files.length} 个文件或目录将被写入目标工作区。</p>
            </div>
            {dryRun.warnings.length > 0 ? (
              <ControlCenterStatusBadge tone="warning">
                {dryRun.warnings.length} warning
              </ControlCenterStatusBadge>
            ) : null}
          </header>
          <div className="cc-surface-section-body">
            {dryRun.warnings.length > 0 ? (
              <div className="cc-control-detail-item" role="alert">
                {dryRun.warnings.join("；")}
              </div>
            ) : null}
            <div className="cc-control-path-list">
              {dryRun.files.map((file) => (
                <div key={file.relPath} className="cc-control-path-item">
                  <strong>{file.isDir ? "目录" : "文件"}</strong>
                  <code>{file.relPath}</code>
                  {file.preview ? (
                    <pre className="cc-code-preview">{file.preview}</pre>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {createdWorkspace ? (
        <section className="cc-surface-section">
          <header className="cc-surface-section-header">
            <div className="cc-surface-section-copy">
              <h4>创建结果</h4>
              <p>{createdWorkspace.cwd}</p>
            </div>
            <Button
              variant="outline"
              icon={<FolderOpen size={15} />}
              onClick={() => void handleOpenWorkspace(createdWorkspace)}
              disabled={busy}
            >
              打开工作区
            </Button>
          </header>
        </section>
      ) : null}
    </div>
  ) : null;

  const workspaceDetail = selectedWorkspace ? (
    <DirectoryFilePreview
      entityKey={`workspace:${selectedWorkspace.id}`}
      description={selectedWorkspace.cwd}
      loadEntries={loadSelectedWorkspaceFileEntries}
      readFile={readSelectedWorkspaceFile}
      onOpenRoot={() => onOpenWorkspace(selectedWorkspace.cwd)}
      showDescription={false}
      className="workspace-hub-workspace-file-preview"
    />
  ) : null;

  const railGroups = useMemo<UnifiedRailGroup[]>(
    () => [
      {
        id: "workspace_hub:harnesses",
        label: "Harness 模板",
        count: harnesses.length,
        collapsible: true,
        items: harnesses.map((harness) => {
          const itemId = makeHarnessItemId(harness.id);
          return {
            id: itemId,
            label: harness.name,
            meta: `v${harness.version}`,
            active: itemId === selectedItemId,
            onSelect: () => setSelectedItemId(itemId),
          };
        }),
      },
      {
        id: "workspace_hub:workspaces",
        label: "已注册工作区",
        count: workspaces.length,
        collapsible: true,
        items: workspaces.map((workspace) => {
          const itemId = makeWorkspaceItemId(workspace.id);
          return {
            id: itemId,
            label: workspace.name,
            statusLabel: "ready",
            statusTone: "success" as const,
            active: itemId === selectedItemId,
            onSelect: () => setSelectedItemId(itemId),
          };
        }),
      },
    ],
    [harnesses, selectedItemId, workspaces],
  );

  useEffect(() => {
    onRailGroupsChange?.(railGroups);
  }, [onRailGroupsChange, railGroups]);

  const detailContent = selectedKind === "workspace" ? workspaceDetail : harnessDetail;
  const showWorkspaceDetailHeader = detailOnly && Boolean(selectedWorkspace);

  if (detailOnly) {
    return (
      <section
        className="cc-image-detail-page workspace-hub-panel workspace-hub-panel-detail-only"
        onKeyDownCapture={handleWorkspaceHubKeyDown}
      >
        <div
          id={focusDomId("workspace_hub")}
          className={`cc-image-detail-top ${
            showWorkspaceDetailHeader ? "workspace-hub-detail-top" : ""
          } ${activeFocusId === "workspace_hub" ? "is-focus" : ""}`}
        >
          {showWorkspaceDetailHeader && selectedWorkspace ? (
            <>
              <div className="workspace-hub-top-title">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon={<ChevronLeft size={14} />}
                  onClick={handleBackToDirectory}
                  disabled={busy}
                >
                  返回
                </Button>
                <h1>{selectedWorkspace.name}</h1>
              </div>
              <div className="cc-image-top-controls workspace-hub-detail-top-actions">
                <ControlCenterStatusBadge tone="success">已注册</ControlCenterStatusBadge>
                <ControlCenterStatusBadge tone="neutral">
                  {formatRuntime(selectedWorkspace.agentRuntime)}
                </ControlCenterStatusBadge>
                <ControlCenterStatusBadge tone="neutral">
                  {selectedWorkspace.source}
                </ControlCenterStatusBadge>
                {onOpenSchedule ? (
                  <Button
                    variant="ghost"
                    icon={<CalendarClock size={15} />}
                    onClick={onOpenSchedule}
                  >
                    编辑调度
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  icon={<Play size={15} />}
                  onClick={() => void handleOpenWorkspace(selectedWorkspace)}
                  disabled={busy}
                >
                  打开工作区
                </Button>
              </div>
            </>
          ) : (
            <>
              <div>
                <h1>WorkspaceHub</h1>
              </div>
              <div className="cc-image-top-controls">
                <Button
                  variant="outline"
                  size="icon-sm"
                  icon={<RefreshCw size={15} />}
                  onClick={refresh}
                  disabled={busy}
                  aria-label="刷新 WorkspaceHub"
                />
              </div>
            </>
          )}
        </div>

        {detailContent && selectedKind === "workspace" ? (
          <section className="workspace-hub-workspace-detail">
            {detailContent}
          </section>
        ) : detailContent ? (
          <section className="cc-image-card workspace-hub-detail-card">
            {detailContent}
          </section>
        ) : (
        <section className="workspace-hub-directory-panel">
          <div className="directory-toolbar">
            <Input
              value={directoryQuery}
              onChange={(event) => setDirectoryQuery(event.currentTarget.value)}
              placeholder="搜索 Harness、工作区、路径或 runtime"
              aria-label="搜索 WorkspaceHub"
            />
            <select
              value={directoryFilter}
              onChange={(event) => setDirectoryFilter(event.currentTarget.value as WorkspaceHubDirectoryFilter)}
              aria-label="WorkspaceHub 高级筛选"
            >
              <option value="all">全部筛选</option>
              <option value="kimi_code">Kimi Code</option>
              <option value="hermes">Hermes</option>
              <option value="other_runtime">其他 Runtime</option>
              <option value="recent">最近打开</option>
              <option value="harness_source">Harness 来源</option>
              <option value="manual">手动</option>
            </select>
            <select
              value={directorySort}
              onChange={(event) => setDirectorySort(event.currentTarget.value as WorkspaceHubSortKey)}
              aria-label="WorkspaceHub 排序"
            >
              <option value="name">名称 A-Z</option>
              <option value="recent">最近打开</option>
              <option value="runtime">Runtime</option>
              <option value="source">来源</option>
            </select>
          </div>
          <DirectoryCardGrid
            className="workspace-hub-directory-grid"
            items={directoryCards}
            loading={busy && directoryCards.length === 0}
            empty={
              <ControlCenterEmptyState
                title={harnesses.length + workspaces.length === 0 ? "还没有对象" : "没有匹配结果"}
                description={
                  harnesses.length + workspaces.length === 0
                    ? "内置模板或注册工作区加载后会显示在这里。"
                    : "清空搜索或切换筛选条件。"
                }
                icon={<Boxes size={18} />}
              />
            }
          />
        </section>
        )}
        {message ? (
          <div className="cc-control-detail-item" role="alert">
            {message}
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <div className="cc-control-stack workspace-hub-panel" onKeyDownCapture={handleWorkspaceHubKeyDown}>
      <ControlCenterWorkbenchLayout
        mode="stack-on-mobile"
        className="workspace-hub-workbench"
        railHeader={
          <div className="cc-control-toolbar">
            <div className="cc-control-rail-title-row">
              <h4>WorkspaceHub</h4>
              <Button
                variant="outline"
                size="icon-sm"
                icon={<RefreshCw size={15} />}
                onClick={refresh}
                disabled={busy}
                aria-label="刷新 WorkspaceHub"
              />
            </div>
          </div>
        }
        rail={rail}
        detail={detailContent}
        emptyDetail={
          <ControlCenterEmptyState
            title="选择对象"
            description="从左侧选择一个 harness 模板或已注册工作区。"
            icon={<Boxes size={18} />}
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
