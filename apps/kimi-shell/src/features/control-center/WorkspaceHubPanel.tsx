import { useEffect, useMemo, useState } from "react";
import { Boxes, FolderOpen, Play, RefreshCw, Search, Sparkles } from "lucide-react";
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

function valueFrom(values: Record<string, string>, key: string) {
  return values[key] ?? "";
}

export function WorkspaceHubPanel({ onOpenWorkspace }: WorkspaceHubPanelProps) {
  const [harnesses, setHarnesses] = useState<HarnessManifest[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [selectedHarnessId, setSelectedHarnessId] = useState<string>("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [dryRun, setDryRun] = useState<HarnessDryRunResult | null>(null);
  const [createdWorkspace, setCreatedWorkspace] = useState<WorkspaceRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selectedHarness = useMemo(
    () => harnesses.find((harness) => harness.id === selectedHarnessId) ?? null,
    [harnesses, selectedHarnessId],
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
      setSelectedHarnessId((current) => current || nextHarnesses[0]?.id || "");
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
      setCreatedWorkspace(result.workspace);
      setMessage(`已创建 ${result.workspace.name}，写入 ${result.fileCount} 个文件。`);
      setDryRun(null);
      setWorkspaces(await listWorkspaces());
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

  return (
    <div className="space-y-4 text-[var(--foreground)]">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase text-[var(--muted-foreground)]">
              WorkspaceHub
            </p>
            <h2 className="mt-1 text-lg font-semibold">工作区创建</h2>
          </div>
          <Button variant="outline" size="sm" icon={<RefreshCw size={15} />} onClick={refresh} disabled={busy}>
            刷新
          </Button>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(220px,280px)_1fr]">
          <div className="space-y-2">
            {harnesses.map((harness) => (
              <button
                key={harness.id}
                type="button"
                className={`w-full rounded-md border px-3 py-3 text-left transition-colors ${
                  harness.id === selectedHarnessId
                    ? "border-[var(--accent)] bg-[var(--muted)]"
                    : "border-[var(--border)] bg-transparent hover:bg-[var(--muted)]"
                }`}
                onClick={() => setSelectedHarnessId(harness.id)}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <Boxes size={15} />
                  {harness.name}
                </span>
                <span className="mt-1 block text-xs text-[var(--muted-foreground)]">
                  {formatRuntime(harness.agentRuntime)} · v{harness.version}
                </span>
              </button>
            ))}
            {harnesses.length === 0 ? (
              <div className="rounded-md border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted-foreground)]">
                未找到内置 harness。
              </div>
            ) : null}
          </div>

          <div className="space-y-4">
            {selectedHarness ? (
              <>
                <div className="rounded-md border border-[var(--border)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-base font-semibold">{selectedHarness.name}</h3>
                      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                        {selectedHarness.summary}
                      </p>
                    </div>
                    <span className="rounded-sm border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted-foreground)]">
                      {selectedHarness.id}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {selectedHarness.variables.map((variable) => (
                      <label key={variable.key} className="space-y-1 text-sm">
                        <span className="font-medium">
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
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button variant="outline" icon={<Search size={15} />} onClick={handleDryRun} disabled={busy}>
                      预览文件
                    </Button>
                    <Button icon={<Sparkles size={15} />} onClick={handleCreate} disabled={busy}>
                      创建工作区
                    </Button>
                    {createdWorkspace ? (
                      <Button
                        variant="ghost"
                        icon={<FolderOpen size={15} />}
                        onClick={() => void handleOpenWorkspace(createdWorkspace)}
                        disabled={busy}
                      >
                        打开
                      </Button>
                    ) : null}
                  </div>
                </div>

                {dryRun ? (
                  <div className="rounded-md border border-[var(--border)] p-3">
                    <h3 className="text-sm font-semibold">文件预览</h3>
                    {dryRun.warnings.length ? (
                      <div className="mt-2 rounded-md border border-[var(--warning)]/60 bg-[var(--warning)]/10 p-2 text-xs">
                        {dryRun.warnings.join("；")}
                      </div>
                    ) : null}
                    <div className="mt-2 max-h-64 overflow-auto rounded-md border border-[var(--border)]">
                      {dryRun.files.map((file) => (
                        <div key={file.relPath} className="border-b border-[var(--border)] px-3 py-2 last:border-b-0">
                          <div className="font-mono text-xs">{file.relPath}</div>
                          {file.preview ? (
                            <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-[var(--muted)] p-2 text-xs">
                              {file.preview}
                            </pre>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">已注册工作区</h2>
          <span className="text-xs text-[var(--muted-foreground)]">{workspaces.length} 个</span>
        </div>
        <div className="mt-3 grid gap-2">
          {workspaces.map((workspace) => (
            <div
              key={workspace.id}
              className="grid gap-3 rounded-md border border-[var(--border)] p-3 md:grid-cols-[1fr_auto]"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-sm font-semibold">{workspace.name}</h3>
                  <span className="rounded-sm bg-[var(--muted)] px-2 py-1 text-xs text-[var(--muted-foreground)]">
                    {formatRuntime(workspace.agentRuntime)}
                  </span>
                  {workspace.harnessId ? (
                    <span className="rounded-sm bg-[var(--muted)] px-2 py-1 text-xs text-[var(--muted-foreground)]">
                      {workspace.harnessId}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 truncate font-mono text-xs text-[var(--muted-foreground)]">
                  {workspace.cwd}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                icon={<Play size={15} />}
                onClick={() => void handleOpenWorkspace(workspace)}
                disabled={busy}
              >
                打开
              </Button>
            </div>
          ))}
          {workspaces.length === 0 ? (
            <div className="rounded-md border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted-foreground)]">
              还没有注册工作区。
            </div>
          ) : null}
        </div>
      </section>

      {message ? (
        <div className="rounded-md border border-[var(--border)] bg-[var(--muted)] p-3 text-sm">
          {message}
        </div>
      ) : null}
    </div>
  );
}
