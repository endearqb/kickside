import { useEffect, useMemo, useRef, useState } from "react";
import { Layers3, X } from "lucide-react";
import { IconButton } from "@/components/common/IconButton";
import {
  WORKSPACE_GRID_MAX_TOTAL_PANES,
  useWorkspaceGridStore,
} from "./gridStore";
import type { WorkspacePane } from "./gridTypes";

export function PaneShelf() {
  const panes = useWorkspaceGridStore((state) => state.panes);
  const slots = useWorkspaceGridStore((state) => state.slots);
  const activePaneId = useWorkspaceGridStore((state) => state.activePaneId);
  const showPane = useWorkspaceGridStore((state) => state.showPane);
  const removePane = useWorkspaceGridStore((state) => state.removePane);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const visibleIds = useMemo(
    () => slots.map((slot) => slot.paneId).filter((id): id is string => Boolean(id)),
    [slots],
  );
  const visibleSet = useMemo(() => new Set(visibleIds), [visibleIds]);
  const visiblePanes = visibleIds
    .map((id) => panes.find((pane) => pane.id === id))
    .filter((pane): pane is WorkspacePane => Boolean(pane));
  const shelvedPanes = panes.filter((pane) => !visibleSet.has(pane.id));
  const countLabel = shelvedPanes.length
    ? `${visiblePanes.length}+${shelvedPanes.length}`
    : `${visiblePanes.length}`;

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="titlebar-layout-menu-wrap pane-shelf-root">
      <IconButton
        icon={<Layers3 size={14} />}
        label={`窗格 ${countLabel}，打开窗格库`}
        onClick={() => setOpen((value) => !value)}
        className={`ghost mini pane-shelf-trigger ${open ? "is-active" : ""}`}
      />
      <span className="pane-shelf-count" aria-hidden>{countLabel}</span>
      {open ? (
        <div className="titlebar-layout-popover pane-shelf-popover" role="dialog" aria-label="窗格库">
          <div className="pane-shelf-summary">
            窗格 {panes.length}/{WORKSPACE_GRID_MAX_TOTAL_PANES}
          </div>
          <PaneList
            title="当前布局"
            panes={visiblePanes}
            activePaneId={activePaneId}
            onOpen={showPane}
            onRemove={removePane}
          />
          <PaneList
            title={`已收纳 ${shelvedPanes.length}`}
            panes={shelvedPanes}
            activePaneId={activePaneId}
            onOpen={showPane}
            onRemove={removePane}
          />
        </div>
      ) : null}
    </div>
  );
}

type PaneListProps = {
  title: string;
  panes: WorkspacePane[];
  activePaneId: string | null;
  onOpen: (paneId: string) => void;
  onRemove: (paneId: string) => void;
};

function PaneList({ title, panes, activePaneId, onOpen, onRemove }: PaneListProps) {
  return (
    <section className="pane-shelf-section">
      <h3>{title}</h3>
      {panes.length ? panes.map((pane) => (
        <div className={`pane-shelf-item${pane.id === activePaneId ? " is-active" : ""}`} key={pane.id}>
          <button type="button" onClick={() => onOpen(pane.id)} title={pane.workDir || pane.title}>
            <strong>{pane.title}</strong>
            <small>{pane.workDir || pane.sessionId || pane.kind}</small>
          </button>
          <button type="button" onClick={() => onRemove(pane.id)} aria-label={`关闭 ${pane.title}`}>
            <X size={13} aria-hidden />
          </button>
        </div>
      )) : <p>无</p>}
    </section>
  );
}
