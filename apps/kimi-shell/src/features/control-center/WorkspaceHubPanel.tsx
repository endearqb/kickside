import { useEffect, useMemo, useState } from "react";
import { Boxes, FolderOpen, Play, RefreshCw, Search, Sparkles } from "lucide-react";
import { ControlCenterDescList } from "@/components/control-center/ControlCenterDescList";
import { ControlCenterEmptyState } from "@/components/control-center/ControlCenterEmptyState";
import { ControlCenterStatusBadge } from "@/components/control-center/ControlCenterStatusBadge";
import { ControlCenterWorkbenchLayout } from "@/components/control-center/ControlCenterWorkbenchLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createHarnessWorkspace,
  dryRunHarness,
  listHarnesses,
  listWorkspaces,
  markWorkspaceOpened,
  type HarnessDryRunResult,
  type HarnessManifest,
  type WorkspaceRecord,
} from "./controlCenterRebuildApi";

type WorkspaceHubPanelProps = {
  onOpenWorkspace: (path: string) => Promise<void>;
};

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

function makeHarnessItemId(id: string) {
  return `harness:${id}`;
}

function makeWorkspaceItemId(id: string) {
  return `workspace:${id}`;
}

export function WorkspaceHubPanel({ onOpenWorkspace }: WorkspaceHubPanelProps) {
  const [harnesses, setHarnesses] = useState<HarnessManifest[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [dryRun, setDryRun] = useState<HarnessDryRunResult | null>(null);
  const [createdWorkspace, setCreatedWorkspace] = useState<WorkspaceRecord | null>(null);
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

  useEffect(() => {
    void refresh();
  }, []);

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

  const rail = (
    <div className="cc-control-list" aria-label="WorkspaceHub 对象列表">
      <div className="cc-primary-nav-group-label">Harness 模板</div>
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

      <div className="cc-primary-nav-group-label">已注册工作区</div>
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

      <section className="cc-surface-section">
        <header className="cc-surface-section-header">
          <div className="cc-surface-section-copy">
            <h4>变量</h4>
            <p>Secret 字段不会在预览中插值。</p>
          </div>
        </header>
        <div className="cc-surface-section-body">
          <div className="cc-control-detail-grid">
            {selectedHarness.variables.map((variable) => (
              <label key={variable.key} className="cc-control-field">
                <span>
                  {variable.label}
                  {variable.required ? " *" : ""}
                </span>
                <Input
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
              </label>
            ))}
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
    <div className="cc-control-detail-stack">
      <div className="cc-control-detail-head">
        <div className="cc-control-detail-copy">
          <h3>{selectedWorkspace.name}</h3>
          <div className="cc-control-chip-row">
            <ControlCenterStatusBadge tone="success">已注册</ControlCenterStatusBadge>
            <ControlCenterStatusBadge tone="neutral">
              {formatRuntime(selectedWorkspace.agentRuntime)}
            </ControlCenterStatusBadge>
            <ControlCenterStatusBadge tone="neutral">{selectedWorkspace.source}</ControlCenterStatusBadge>
          </div>
        </div>
        <Button
          variant="outline"
          icon={<Play size={15} />}
          onClick={() => void handleOpenWorkspace(selectedWorkspace)}
          disabled={busy}
        >
          打开工作区
        </Button>
      </div>

      <ControlCenterDescList
        columns={4}
        items={[
          { label: "工作区路径", value: selectedWorkspace.cwd },
          { label: "Harness", value: selectedWorkspace.harnessId ?? "manual" },
          { label: "创建时间", value: formatDate(selectedWorkspace.createdAt) },
          { label: "上次打开", value: formatDate(selectedWorkspace.lastOpenedAt) },
        ]}
      />

      {selectedWorkspace.tags.length > 0 ? (
        <div className="cc-control-chip-row">
          {selectedWorkspace.tags.map((tag) => (
            <ControlCenterStatusBadge key={tag} tone="neutral">
              {tag}
            </ControlCenterStatusBadge>
          ))}
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <div className="cc-control-stack workspace-hub-panel">
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
        detail={selectedKind === "workspace" ? workspaceDetail : harnessDetail}
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
