import { useEffect, useMemo, useRef, useState } from "react";
import { Layers3, PanelTopOpen, X } from "lucide-react";
import type { WorkspaceGridSlot, WorkspacePane } from "./gridTypes";

type PaneShelfProps = {
  panes: readonly WorkspacePane[];
  slots: readonly WorkspaceGridSlot[];
  activePaneId: string | null;
  maxTotalPanes: number;
  onShowPane: (paneId: string) => void;
  onRemovePane: (paneId: string) => void;
};

/**
 * Titlebar popover for visible and shelved panes.
 *
 * Recommended placement: immediately after the existing layout button in
 * ShellTitlebar. Hidden panes are not rendered by WorkspaceGridView, so the
 * popover is the stable route back to those sessions.
 */
export function PaneShelf({
  panes,
  slots,
  activePaneId,
  maxTotalPanes,
  onShowPane,
  onRemovePane,
}: PaneShelfProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const visiblePaneIds = useMemo(
    () =>
      slots
        .map((slot) => slot.paneId)
        .filter((paneId): paneId is string => Boolean(paneId)),
    [slots],
  );
  const visibleSet = useMemo(() => new Set(visiblePaneIds), [visiblePaneIds]);
  const visiblePanes = useMemo(
    () =>
      visiblePaneIds
        .map((paneId) => panes.find((pane) => pane.id === paneId))
        .filter((pane): pane is WorkspacePane => Boolean(pane)),
    [panes, visiblePaneIds],
  );
  const shelfPanes = useMemo(
    () =>
      panes
        .filter((pane) => !visibleSet.has(pane.id))
        .sort((left, right) => right.updatedAt - left.updatedAt),
    [panes, visibleSet],
  );
  const label =
    shelfPanes.length > 0
      ? `窗格 ${visiblePanes.length}+${shelfPanes.length}`
      : `窗格 ${visiblePanes.length}`;

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="pane-shelf-root">
      <button
        type="button"
        className={`icon-btn ghost mini pane-shelf-trigger${open ? " is-active" : ""}`}
        aria-label={`${label}，打开窗格库`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Layers3 size={14} aria-hidden />
        <span className="pane-shelf-trigger-label">{label}</span>
      </button>

      {open ? (
        <div className="pane-shelf-popover" role="dialog" aria-label="窗格库">
          <header className="pane-shelf-header">
            <div>
              <strong>窗格库</strong>
              <span>
                可见 {visiblePanes.length} / 6，总计 {panes.length} / {maxTotalPanes}
              </span>
            </div>
            <button
              type="button"
              className="icon-btn ghost mini"
              aria-label="关闭窗格库"
              onClick={() => setOpen(false)}
            >
              <X size={14} aria-hidden />
            </button>
          </header>

          <PaneSection
            title="当前布局"
            panes={visiblePanes}
            activePaneId={activePaneId}
            emptyText="当前没有可见窗格"
            onOpen={(paneId) => {
              onShowPane(paneId);
              setOpen(false);
            }}
            onRemove={onRemovePane}
          />

          <PaneSection
            title={`已收纳 (${shelfPanes.length})`}
            panes={shelfPanes}
            activePaneId={activePaneId}
            emptyText="没有被收纳的窗格"
            onOpen={(paneId) => {
              onShowPane(paneId);
              setOpen(false);
            }}
            onRemove={onRemovePane}
          />
        </div>
      ) : null}
    </div>
  );
}

type PaneSectionProps = {
  title: string;
  panes: readonly WorkspacePane[];
  activePaneId: string | null;
  emptyText: string;
  onOpen: (paneId: string) => void;
  onRemove: (paneId: string) => void;
};

function PaneSection({
  title,
  panes,
  activePaneId,
  emptyText,
  onOpen,
  onRemove,
}: PaneSectionProps) {
  return (
    <section className="pane-shelf-section">
      <h3>{title}</h3>
      {panes.length === 0 ? (
        <p className="pane-shelf-empty">{emptyText}</p>
      ) : (
        <div className="pane-shelf-list" role="list">
          {panes.map((pane) => (
            <div
              key={pane.id}
              className={`pane-shelf-item${pane.id === activePaneId ? " is-active" : ""}`}
              role="listitem"
            >
              <button
                type="button"
                className="pane-shelf-open"
                title={pane.workDir || pane.title}
                onClick={() => onOpen(pane.id)}
              >
                <PanelTopOpen size={14} aria-hidden />
                <span className="pane-shelf-copy">
                  <strong>{pane.title}</strong>
                  <small>{paneSubtitle(pane)}</small>
                </span>
              </button>
              <button
                type="button"
                className="icon-btn ghost mini pane-shelf-remove"
                aria-label={`关闭 ${pane.title}`}
                onClick={() => onRemove(pane.id)}
              >
                <X size={13} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function paneSubtitle(pane: WorkspacePane): string {
  if (pane.workDir) {
    const normalized = pane.workDir.replace(/[\\/]+$/, "");
    const parts = normalized.split(/[\\/]/);
    return parts.at(-1) || normalized;
  }
  if (pane.kind === "code" && pane.sessionId) return `会话 ${pane.sessionId.slice(0, 10)}`;
  if (pane.kind === "chat") return "Kimi Chat";
  return pane.kind === "external" ? "外部网页" : "Kimi Code";
}
