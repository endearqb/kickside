import {
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { WorkspaceViewProps } from "@/features/workspace/WorkspaceView";
import { openExternalWebviewWindow } from "@/services/externalWebviewService";
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
  useWorkspaceGridStore,
} from "./gridStore";
import type {
  WorkspaceGridSlot,
  WorkspaceGridTrackSizes,
  WorkspacePane,
  WorkspacePaneKind,
} from "./gridTypes";
import { PaneFrame } from "./PaneFrame";
import { normalizeEmbeddableUrl } from "./urlSafety";

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
  const addPane = useWorkspaceGridStore((state) => state.addPane);
  const removePane = useWorkspaceGridStore((state) => state.removePane);
  const swapSlots = useWorkspaceGridStore((state) => state.swapSlots);
  const maximizePane = useWorkspaceGridStore((state) => state.maximizePane);
  const setActivePane = useWorkspaceGridStore((state) => state.setActivePane);
  const setPaneMountPolicy = useWorkspaceGridStore(
    (state) => state.setPaneMountPolicy,
  );
  const configurePane = useWorkspaceGridStore((state) => state.configurePane);
  const setPaneTheme = useWorkspaceGridStore((state) => state.setPaneTheme);
  const setGridTrackSizes = useWorkspaceGridStore(
    (state) => state.setGridTrackSizes,
  );
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [gridMessage, setGridMessage] = useState("");
  const [resizeDraft, setResizeDraft] = useState<ResizeDraft | null>(null);
  const [draggedSlotId, setDraggedSlotId] = useState<string | null>(null);

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
    let input = defaultPaneInput(
      kind,
      props.chatRemoteUrl,
      props.effectiveWorkDir,
    );

    if (kind === "external") {
      const externalInput = readExternalPaneInput(props.chatRemoteUrl);
      if (!externalInput) {
        setGridMessage("已取消添加外部网页");
        return;
      }
      input = externalInput;
    }

    const paneId = addPane(input, slotId);
    if (!paneId) {
      if (!gridMessage) {
        setGridMessage("没有可用空窗格，或已达到 6 窗格上限");
      }
      return;
    }
  }

  async function handleConfigurePane(paneId: string, kind: WorkspacePaneKind) {
    const existingPane = panes.find((pane) => pane.id === paneId);
    if (existingPane?.kind === kind && kind !== "external") {
      return;
    }

    setGridMessage("");
    let input =
      kind === "external"
        ? readExternalPaneInput(props.chatRemoteUrl)
        : defaultPaneInput(kind, props.chatRemoteUrl, props.effectiveWorkDir);
    if (!input) {
      setGridMessage("已取消切换外部网页");
      return;
    }

    configurePane(paneId, input);
  }

  function handleSlotDragStart(slotId: string, event: DragEvent<HTMLElement>) {
    setDraggedSlotId(slotId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", slotId);
  }

  function handleSlotDragOver(slotId: string, event: DragEvent<HTMLDivElement>) {
    const sourceSlotId = draggedSlotId || event.dataTransfer.getData("text/plain");
    if (!sourceSlotId || sourceSlotId === slotId) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function handleSlotDrop(slotId: string, event: DragEvent<HTMLDivElement>) {
    const sourceSlotId = draggedSlotId || event.dataTransfer.getData("text/plain");
    setDraggedSlotId(null);
    if (!sourceSlotId || sourceSlotId === slotId) {
      return;
    }
    event.preventDefault();
    swapSlots(sourceSlotId, slotId);
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

  async function handleOpenTauriWebviewUrl(
    url: string,
    title: string,
    storageNamespace?: string,
  ) {
    try {
      await openExternalWebviewWindow({ url, title, storageNamespace });
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
  }

  return (
    <section
      className="workspace-stage workspace-stage-grid-shell"
      aria-label="Workspace Grid"
      tabIndex={0}
      onKeyDown={handleGridKeyDown}
    >
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
              onDragOver={(event) => handleSlotDragOver(slot.id, event)}
              onDrop={(event) => handleSlotDrop(slot.id, event)}
            >
              <PaneFrame
                pane={pane}
                slotLabel={slot.id}
                active={Boolean(pane && pane.id === activePaneId)}
                maximized={Boolean(pane && pane.id === maximizedPaneId)}
                canAddPane={canAddPane}
                effectiveWorkDir={props.effectiveWorkDir}
                themeMode={props.themeMode}
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
                onOpenFolder={props.onOpenFolder}
                onOpenExternalUrl={props.onOpenExternalUrl}
                onOpenTauriWebviewUrl={(url, title, storageNamespace) => {
                  void handleOpenTauriWebviewUrl(url, title, storageNamespace);
                }}
                onCodeFrameLoad={props.onCodeFrameLoad}
                onCodeFrameError={props.onCodeFrameError}
                onChatFrameLoad={props.onChatFrameLoad}
                onChatFrameError={props.onChatFrameError}
                onActivate={() => setActivePane(pane?.id ?? null)}
                onAddPane={(kind) => {
                  void handleAddPane(slot.id, kind);
                }}
                onConfigurePane={(kind) => {
                  if (pane) {
                    void handleConfigurePane(pane.id, kind);
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
                onPaneThemeChange={(theme) => {
                  if (pane) {
                    setPaneTheme(pane.id, theme);
                  }
                }}
                onDragStart={(event) => handleSlotDragStart(slot.id, event)}
                onDragEnd={() => setDraggedSlotId(null)}
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
  effectiveWorkDir?: string,
): AddWorkspacePaneInput {
  if (kind === "code") {
    return { kind, title: "Kimi Code", workDir: effectiveWorkDir };
  }
  if (kind === "chat") {
    return { kind, title: "Kimi Chat" };
  }
  return { kind, title: "外部网页", url: chatRemoteUrl };
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
