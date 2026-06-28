import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { WorkspaceViewProps } from "@/features/workspace/WorkspaceView";
import { openExternalWebviewWindow } from "@/services/externalWebviewService";
import { createGridSession } from "@/services/workspaceGridService";
import {
  GRID_PRESETS,
  createEqualTrackSizes,
  getGridTrackCounts,
  gridTrackSizesToCss,
  normalizeGridTrackSizes,
  resizeGridTrackSizes,
} from "./gridPresets";
import {
  WORKSPACE_GRID_MAX_PANES,
  type AddWorkspacePaneInput,
  loadWorkspaceGridSavedLayouts,
  saveWorkspaceGridSavedLayouts,
  upsertWorkspaceGridSavedLayout,
  useWorkspaceGridStore,
} from "./gridStore";
import type {
  WorkspaceGridPresetId,
  WorkspaceGridSlot,
  WorkspaceGridTrackSizes,
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

type ResizeAxis = "columns" | "rows";

interface ResizeDraft {
  axis: ResizeAxis;
  index: number;
  startClient: number;
  totalPx: number;
  startSizes: number[];
  startTrackSizes: WorkspaceGridTrackSizes;
}

export function WorkspaceGridView(props: WorkspaceViewProps) {
  const preset = useWorkspaceGridStore((state) => state.preset);
  const panes = useWorkspaceGridStore((state) => state.panes);
  const slots = useWorkspaceGridStore((state) => state.slots);
  const activePaneId = useWorkspaceGridStore((state) => state.activePaneId);
  const maximizedPaneId = useWorkspaceGridStore((state) => state.maximizedPaneId);
  const trackSizes = useWorkspaceGridStore((state) => state.trackSizes);
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
  const setGridTrackSizes = useWorkspaceGridStore(
    (state) => state.setGridTrackSizes,
  );
  const restoreGridState = useWorkspaceGridStore((state) => state.restoreGridState);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [gridMessage, setGridMessage] = useState("");
  const [sessionBusySlot, setSessionBusySlot] = useState<string | null>(null);
  const [savedLayouts, setSavedLayouts] = useState(() =>
    loadWorkspaceGridSavedLayouts(),
  );
  const [selectedLayoutId, setSelectedLayoutId] = useState("");
  const [resizeDraft, setResizeDraft] = useState<ResizeDraft | null>(null);

  const template = GRID_PRESETS[preset];
  const trackCounts = getGridTrackCounts(preset);
  const customTrackSizes = normalizeGridTrackSizes(trackSizes, preset);
  const effectiveColumns =
    customTrackSizes?.columns ?? createEqualTrackSizes(trackCounts.columns);
  const effectiveRows =
    customTrackSizes?.rows ?? createEqualTrackSizes(trackCounts.rows);
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
        gridTemplateColumns:
          gridTrackSizesToCss(customTrackSizes?.columns, trackCounts.columns) ??
          template.columns,
        gridTemplateRows:
          gridTrackSizesToCss(customTrackSizes?.rows, trackCounts.rows) ??
          template.rows,
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

  function handleSaveLayout() {
    const name = window.prompt("保存当前布局名称", GRID_PRESETS[preset].label);
    const trimmedName = name?.trim();
    if (!trimmedName) {
      setGridMessage("已取消保存布局");
      return;
    }

    const nextLayouts = upsertWorkspaceGridSavedLayout(
      savedLayouts,
      trimmedName,
      useWorkspaceGridStore.getState(),
    );
    saveWorkspaceGridSavedLayouts(nextLayouts);
    setSavedLayouts(nextLayouts);
    setSelectedLayoutId(
      nextLayouts.find((layout) => layout.name === trimmedName)?.id ?? "",
    );
    setGridMessage(`已保存布局：${trimmedName}`);
  }

  function handleRestoreLayout(layoutId: string) {
    setSelectedLayoutId(layoutId);
    const layout = savedLayouts.find((item) => item.id === layoutId);
    if (!layout) {
      return;
    }
    restoreGridState(layout.state);
    setGridMessage(`已恢复布局：${layout.name}`);
  }

  async function handleOpenTauriWebviewUrl(url: string, title: string) {
    try {
      await openExternalWebviewWindow({ url, title });
      setGridMessage("已在独立应用窗口打开");
    } catch (error) {
      setGridMessage(`应用窗口打开失败：${String(error)}`);
    }
  }

  function handleResizeStart(
    axis: ResizeAxis,
    index: number,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (maximizedPaneId) {
      return;
    }
    const rect = canvasRef.current?.getBoundingClientRect();
    const totalPx = axis === "columns" ? rect?.width : rect?.height;
    if (!totalPx) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setResizeDraft({
      axis,
      index,
      startClient: axis === "columns" ? event.clientX : event.clientY,
      totalPx,
      startSizes: axis === "columns" ? effectiveColumns : effectiveRows,
      startTrackSizes: customTrackSizes ?? {},
    });
    setGridMessage("正在调整布局尺寸");
  }

  function handleResizeMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!resizeDraft) {
      return;
    }
    const client =
      resizeDraft.axis === "columns" ? event.clientX : event.clientY;
    const resized = resizeGridTrackSizes(
      resizeDraft.startSizes,
      resizeDraft.index,
      client - resizeDraft.startClient,
      resizeDraft.totalPx,
    );
    setGridTrackSizes({
      ...resizeDraft.startTrackSizes,
      [resizeDraft.axis]: resized,
    });
    event.preventDefault();
  }

  function handleResizeEnd() {
    if (!resizeDraft) {
      return;
    }
    setResizeDraft(null);
    setGridMessage("已保存自定义布局尺寸");
  }

  return (
    <section
      className="workspace-stage workspace-stage-grid-shell"
      aria-label="Workspace Grid"
      tabIndex={0}
      onKeyDown={handleGridKeyDown}
    >
      <div className="workspace-grid-toolbar">
        <div className="workspace-grid-toolbar-controls">
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
          <button
            type="button"
            className="workspace-grid-save-btn"
            onClick={handleSaveLayout}
          >
            保存布局
          </button>
          <select
            className="workspace-grid-saved-select"
            aria-label="保存的工作区布局"
            value={selectedLayoutId}
            onChange={(event) => handleRestoreLayout(event.currentTarget.value)}
          >
            <option value="">选择布局</option>
            {savedLayouts.map((layout) => (
              <option key={layout.id} value={layout.id}>
                {layout.name}
              </option>
            ))}
          </select>
        </div>
        <span className="workspace-grid-status">
          {gridMessage ||
            `${countRunningCodePanes(panes)} 个 Code Session 运行中 · ${panes.length} / ${WORKSPACE_GRID_MAX_PANES} 窗格`}
        </span>
      </div>
      <div
        ref={canvasRef}
        className={`workspace-grid-canvas${resizeDraft ? " is-resizing" : ""}`}
        style={gridStyle}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
      >
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
                onOpenTauriWebviewUrl={(url, title) => {
                  void handleOpenTauriWebviewUrl(url, title);
                }}
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
        {!maximizedPaneId
          ? renderResizeHandles("columns", effectiveColumns, handleResizeStart)
          : null}
        {!maximizedPaneId
          ? renderResizeHandles("rows", effectiveRows, handleResizeStart)
          : null}
      </div>
    </section>
  );
}

function renderResizeHandles(
  axis: ResizeAxis,
  sizes: readonly number[],
  onResizeStart: (
    axis: ResizeAxis,
    index: number,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void,
) {
  if (sizes.length < 2) {
    return null;
  }

  const total = sizes.reduce((sum, size) => sum + size, 0);
  let offset = 0;
  return sizes.slice(0, -1).map((size, index) => {
    offset += size;
    const percent = (offset / total) * 100;
    const style =
      axis === "columns"
        ? ({ left: `calc(${percent}% - 4px)` } satisfies CSSProperties)
        : ({ top: `calc(${percent}% - 4px)` } satisfies CSSProperties);
    return (
      <button
        type="button"
        key={`${axis}-${index}`}
        className={`workspace-grid-resize-handle is-${axis}`}
        style={style}
        aria-label={axis === "columns" ? `调整列 ${index + 1}` : `调整行 ${index + 1}`}
        onPointerDown={(event) => onResizeStart(axis, index, event)}
      />
    );
  });
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
