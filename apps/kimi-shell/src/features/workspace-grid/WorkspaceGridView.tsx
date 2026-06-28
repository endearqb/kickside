import { useState, type CSSProperties, type KeyboardEvent } from "react";
import type { WorkspaceViewProps } from "@/features/workspace/WorkspaceView";
import { createGridSession } from "@/services/workspaceGridService";
import { GRID_PRESETS } from "./gridPresets";
import {
  WORKSPACE_GRID_MAX_PANES,
  type AddWorkspacePaneInput,
  useWorkspaceGridStore,
} from "./gridStore";
import type {
  WorkspaceGridPresetId,
  WorkspaceGridSlot,
  WorkspacePane,
  WorkspacePaneKind,
} from "./gridTypes";
import { PaneFrame } from "./PaneFrame";
import { normalizeEmbeddableUrl } from "./urlSafety";

const PRESET_ORDER: WorkspaceGridPresetId[] = [
  "single",
  "1x2",
  "1x3",
  "2x2",
  "2x3-5",
  "2x3",
];

export function WorkspaceGridView(props: WorkspaceViewProps) {
  const preset = useWorkspaceGridStore((state) => state.preset);
  const panes = useWorkspaceGridStore((state) => state.panes);
  const slots = useWorkspaceGridStore((state) => state.slots);
  const activePaneId = useWorkspaceGridStore((state) => state.activePaneId);
  const maximizedPaneId = useWorkspaceGridStore((state) => state.maximizedPaneId);
  const setPreset = useWorkspaceGridStore((state) => state.setPreset);
  const addPane = useWorkspaceGridStore((state) => state.addPane);
  const movePane = useWorkspaceGridStore((state) => state.movePane);
  const removePane = useWorkspaceGridStore((state) => state.removePane);
  const maximizePane = useWorkspaceGridStore((state) => state.maximizePane);
  const setActivePane = useWorkspaceGridStore((state) => state.setActivePane);
  const setPaneMountPolicy = useWorkspaceGridStore(
    (state) => state.setPaneMountPolicy,
  );
  const configurePane = useWorkspaceGridStore((state) => state.configurePane);
  const [gridMessage, setGridMessage] = useState("");
  const [sessionBusySlot, setSessionBusySlot] = useState<string | null>(null);

  const template = GRID_PRESETS[preset];
  const canAddPane = panes.length < WORKSPACE_GRID_MAX_PANES;
  const renderedSlots = maximizedPaneId
    ? [
        {
          id: "maximized",
          area: "main",
          paneId: maximizedPaneId,
        },
      ]
    : slots;
  const gridStyle = maximizedPaneId
    ? ({
        gridTemplateColumns: "minmax(0, 1fr)",
        gridTemplateRows: "minmax(0, 1fr)",
        gridTemplateAreas: '"main"',
      } satisfies CSSProperties)
    : ({
        gridTemplateColumns: template.columns,
        gridTemplateRows: template.rows,
        gridTemplateAreas: template.areas,
      } satisfies CSSProperties);

  function findPane(slot: WorkspaceGridSlot): WorkspacePane | null {
    if (!slot.paneId) {
      return null;
    }
    return panes.find((pane) => pane.id === slot.paneId) ?? null;
  }

  async function handleAddPane(slotId: string, kind: WorkspacePaneKind) {
    setGridMessage("");
    let input = defaultPaneInput(kind, props.chatRemoteUrl);

    if (kind === "external") {
      const externalInput = readExternalPaneInput(props.chatRemoteUrl);
      if (!externalInput) {
        setGridMessage("已取消添加外部网页");
        return;
      }
      input = externalInput;
    }

    if (kind === "code" && props.effectiveWorkDir && props.codeRemoteUrl) {
      setSessionBusySlot(slotId);
      try {
        const session = await createGridSession(props.effectiveWorkDir);
        input = {
          ...input,
          sessionId: session.sessionId,
          title: codePaneTitle(session.sessionId),
        };
        setGridMessage("已创建新的 Code Session");
      } catch (error) {
        setGridMessage(`创建 Code Session 失败：${String(error)}`);
        return;
      } finally {
        setSessionBusySlot(null);
      }
    }

    const paneId = addPane(input);
    if (!paneId) {
      if (!gridMessage) {
        setGridMessage("没有可用空窗格，或已达到 6 窗格上限");
      }
      return;
    }

    movePane(paneId, slotId);
  }

  function handleConfigurePane(paneId: string, kind: WorkspacePaneKind) {
    const input =
      kind === "external"
        ? readExternalPaneInput(props.chatRemoteUrl)
        : defaultPaneInput(kind, props.chatRemoteUrl);
    if (!input) {
      setGridMessage("已取消切换外部网页");
      return;
    }
    configurePane(paneId, input);
  }

  function handleGridKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (
      event.key !== "ArrowRight" &&
      event.key !== "ArrowDown" &&
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowUp"
    ) {
      return;
    }

    const visiblePaneIds = renderedSlots
      .map((slot) => slot.paneId)
      .filter((paneId): paneId is string => Boolean(paneId));
    if (visiblePaneIds.length < 2) {
      return;
    }

    const currentIndex = Math.max(0, visiblePaneIds.indexOf(activePaneId ?? ""));
    const direction =
      event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    const nextIndex =
      (currentIndex + direction + visiblePaneIds.length) % visiblePaneIds.length;
    setActivePane(visiblePaneIds[nextIndex]);
    event.preventDefault();
  }

  return (
    <section
      className="workspace-stage workspace-stage-grid-shell"
      aria-label="Workspace Grid"
      tabIndex={0}
      onKeyDown={handleGridKeyDown}
    >
      <div className="workspace-grid-toolbar">
        <div className="workspace-grid-preset-group" aria-label="工作区布局">
          {PRESET_ORDER.map((presetId) => {
            const presetItem = GRID_PRESETS[presetId];
            return (
              <button
                type="button"
                key={presetId}
                className={`workspace-grid-preset-btn${
                  preset === presetId && !maximizedPaneId ? " is-active" : ""
                }`}
                title={presetItem.label}
                aria-label={presetItem.label}
                onClick={() => setPreset(presetId)}
              >
                {presetItem.slots.length}
              </button>
            );
          })}
        </div>
        <span className="workspace-grid-status">
          {gridMessage ||
            `${countRunningCodePanes(panes)} 个 Code Session 运行中 · ${panes.length} / ${WORKSPACE_GRID_MAX_PANES} 窗格`}
        </span>
      </div>
      <div className="workspace-grid-canvas" style={gridStyle}>
        {renderedSlots.map((slot) => {
          const pane = findPane(slot);
          return (
            <div
              key={slot.id}
              className="workspace-grid-slot"
              style={{ gridArea: slot.area }}
            >
              <PaneFrame
                pane={pane}
                slotLabel={slot.id}
                active={Boolean(pane && pane.id === activePaneId)}
                maximized={Boolean(pane && pane.id === maximizedPaneId)}
                canAddPane={canAddPane}
                codeRemoteUrl={props.codeRemoteUrl}
                codeFrameKey={props.codeFrameKey}
                chatRemoteUrl={props.chatRemoteUrl}
                workspaceIframeRef={props.workspaceIframeRef}
                chatIframeRef={props.chatIframeRef}
                codePaneState={props.codePaneState}
                chatPaneState={props.chatPaneState}
                actionBusy={props.actionBusy}
                onRetry={props.onRetry}
                onOpenLogs={props.onOpenLogs}
                onOpenExternalUrl={props.onOpenExternalUrl}
                onCodeFrameLoad={props.onCodeFrameLoad}
                onCodeFrameError={props.onCodeFrameError}
                onChatFrameLoad={props.onChatFrameLoad}
                onChatFrameError={props.onChatFrameError}
                onActivate={() => setActivePane(pane?.id ?? null)}
                onAddPane={(kind) => {
                  if (sessionBusySlot === null) {
                    void handleAddPane(slot.id, kind);
                  }
                }}
                onConfigurePane={(kind) => {
                  if (pane) {
                    handleConfigurePane(pane.id, kind);
                  }
                }}
                onRemovePane={() => {
                  if (pane) {
                    removePane(pane.id);
                  }
                }}
                onSuspendPane={() => {
                  if (pane) {
                    setPaneMountPolicy(pane.id, "suspended");
                  }
                }}
                onResumePane={() => {
                  if (pane) {
                    setPaneMountPolicy(pane.id, "eager");
                  }
                }}
                onToggleMaximize={() =>
                  maximizePane(pane?.id === maximizedPaneId ? null : pane?.id ?? null)
                }
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function defaultPaneInput(
  kind: WorkspacePaneKind,
  chatRemoteUrl: string,
): AddWorkspacePaneInput {
  if (kind === "code") {
    return { kind, title: "Kimi Code" };
  }
  if (kind === "chat") {
    return { kind, title: "Kimi Chat" };
  }
  return { kind, title: "Kimi.com", url: chatRemoteUrl };
}

function readExternalPaneInput(chatRemoteUrl: string): AddWorkspacePaneInput | null {
  const raw = window.prompt("输入要在窗格中打开的网址", chatRemoteUrl);
  if (raw === null) {
    return null;
  }

  const normalized = normalizeEmbeddableUrl(raw);
  if (!normalized.ok) {
    return null;
  }
  const title = new URL(normalized.url).hostname || "外部网页";
  return { kind: "external", title, url: normalized.url };
}

function countRunningCodePanes(panes: WorkspacePane[]): number {
  return panes.filter((pane) => pane.kind === "code").length;
}

function codePaneTitle(sessionId: string): string {
  const suffix = sessionId.trim().slice(0, 8);
  return suffix ? `Kimi Code ${suffix}` : "Kimi Code";
}
