import {
  useMemo,
  useRef,
  useState,
  useEffect,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type UnifiedRailTone = "neutral" | "success" | "warning" | "danger" | "accent";

export type UnifiedRailItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  meta?: ReactNode;
  statusLabel?: string;
  statusTone?: UnifiedRailTone;
  active?: boolean;
  depth?: 0 | 1 | 2;
  disabled?: boolean;
  onSelect: () => void;
};

export type UnifiedRailGroup = {
  id: string;
  label: string;
  icon?: ReactNode;
  count?: ReactNode;
  collapsible?: boolean;
  items: UnifiedRailItem[];
};

type ControlCenterUnifiedRailProps = {
  title: string;
  groups: UnifiedRailGroup[];
  expandedGroups: Set<string>;
  onToggleGroup: (groupId: string) => void;
  onExit?: () => void;
  exitLabel?: string;
  onItemActivate?: (itemId: string, groupId: string) => void;
  footer?: ReactNode;
};

export function ControlCenterUnifiedRail({
  title,
  groups,
  expandedGroups,
  onToggleGroup,
  onExit,
  exitLabel = "退出",
  onItemActivate,
  footer,
}: ControlCenterUnifiedRailProps) {
  const [focusedEntryId, setFocusedEntryId] = useState("");
  const entryRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const typeaheadRef = useRef("");
  const typeaheadTimerRef = useRef<number | null>(null);
  const focusableEntries = useMemo(
    () => groups.flatMap((group) => {
      const expanded = !group.collapsible || expandedGroups.has(group.id);
      return [
        ...(group.collapsible
          ? [{ id: `group:${group.id}`, label: group.label, groupId: group.id, kind: "group" as const }]
          : []),
        ...(expanded
          ? group.items
              .filter((item) => !item.disabled)
              .map((item) => ({
                id: `item:${item.id}`,
                label: item.label,
                groupId: group.id,
                kind: "item" as const,
              }))
          : []),
      ];
    }),
    [expandedGroups, groups],
  );
  const activeEntryId = groups
    .flatMap((group) => group.items)
    .find((item) => item.active && !item.disabled)?.id;
  const effectiveFocusedEntryId = focusableEntries.some((entry) => entry.id === focusedEntryId)
    ? focusedEntryId
    : activeEntryId && focusableEntries.some((entry) => entry.id === `item:${activeEntryId}`)
      ? `item:${activeEntryId}`
      : focusableEntries[0]?.id ?? "";

  useEffect(
    () => () => {
      if (typeaheadTimerRef.current !== null) window.clearTimeout(typeaheadTimerRef.current);
    },
    [],
  );

  function focusEntry(entryId: string) {
    setFocusedEntryId(entryId);
    entryRefs.current[entryId]?.focus();
  }

  function handleEntryKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    entryId: string,
    groupId: string,
    kind: "group" | "item",
  ) {
    const currentIndex = focusableEntries.findIndex((entry) => entry.id === entryId);
    if (currentIndex < 0) return;

    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? focusableEntries.length - 1
          : event.key === "ArrowUp"
            ? Math.max(0, currentIndex - 1)
            : Math.min(focusableEntries.length - 1, currentIndex + 1);
      focusEntry(focusableEntries[nextIndex]?.id ?? entryId);
      return;
    }

    if (event.key === "ArrowRight" && kind === "group") {
      event.preventDefault();
      if (!expandedGroups.has(groupId)) {
        onToggleGroup(groupId);
      } else {
        const firstChild = focusableEntries.find(
          (entry) => entry.groupId === groupId && entry.kind === "item",
        );
        if (firstChild) focusEntry(firstChild.id);
      }
      return;
    }
    if (event.key === "ArrowLeft") {
      if (kind === "group" && expandedGroups.has(groupId)) {
        event.preventDefault();
        onToggleGroup(groupId);
      } else if (kind === "item" && groups.find((group) => group.id === groupId)?.collapsible) {
        event.preventDefault();
        focusEntry(`group:${groupId}`);
      }
      return;
    }

    if (
      event.key.length !== 1 ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    ) {
      return;
    }
    typeaheadRef.current += event.key.toLocaleLowerCase();
    if (typeaheadTimerRef.current !== null) window.clearTimeout(typeaheadTimerRef.current);
    typeaheadTimerRef.current = window.setTimeout(() => {
      typeaheadRef.current = "";
      typeaheadTimerRef.current = null;
    }, 600);
    const ordered = [
      ...focusableEntries.slice(currentIndex + 1),
      ...focusableEntries.slice(0, currentIndex + 1),
    ];
    const match = ordered.find((entry) =>
      entry.label.toLocaleLowerCase().startsWith(typeaheadRef.current),
    );
    if (match) {
      event.preventDefault();
      focusEntry(match.id);
    }
  }

  return (
    <aside className="cc-unified-rail" aria-label="控制中心导航与对象列表">
      <div className="cc-unified-rail-head">
        <h2>{title}</h2>
        {onExit ? (
          <button type="button" className="cc-unified-rail-exit" onClick={onExit}>
            {exitLabel}
          </button>
        ) : null}
      </div>
      <div className="cc-unified-rail-body">
        {groups.map((group) => {
          const expanded = !group.collapsible || expandedGroups.has(group.id);
          return (
            <section key={group.id} className="cc-unified-rail-group">
              {group.collapsible ? (
                <button
                  ref={(node) => {
                    entryRefs.current[`group:${group.id}`] = node;
                  }}
                  type="button"
                  className="cc-unified-rail-group-head"
                  onClick={() => onToggleGroup(group.id)}
                  onFocus={() => setFocusedEntryId(`group:${group.id}`)}
                  onKeyDown={(event) =>
                    handleEntryKeyDown(event, `group:${group.id}`, group.id, "group")
                  }
                  tabIndex={effectiveFocusedEntryId === `group:${group.id}` ? 0 : -1}
                  aria-expanded={expanded}
                >
                  {group.icon ? <span className="cc-unified-rail-icon">{group.icon}</span> : null}
                  <span>{group.label}</span>
                  {group.count ? <small>{group.count}</small> : null}
                  <ChevronRight
                    size={14}
                    className={cn("cc-unified-rail-chevron", expanded && "is-expanded")}
                  />
                </button>
              ) : (
                <div className="cc-unified-rail-group-label">
                  {group.icon ? <span className="cc-unified-rail-icon">{group.icon}</span> : null}
                  <span>{group.label}</span>
                  {group.count ? <small>{group.count}</small> : null}
                </div>
              )}
              {expanded ? (
                <div className="cc-unified-rail-list">
                  {group.items.map((item) => (
                    <button
                      ref={(node) => {
                        entryRefs.current[`item:${item.id}`] = node;
                      }}
                      key={item.id}
                      type="button"
                      className={cn(
                        "cc-unified-rail-item",
                        item.active && "is-active",
                        item.depth === 1 && "is-child",
                        item.depth === 2 && "is-grandchild",
                      )}
                      onClick={() => {
                        item.onSelect();
                        onItemActivate?.(item.id, group.id);
                      }}
                      onFocus={() => setFocusedEntryId(`item:${item.id}`)}
                      onKeyDown={(event) =>
                        handleEntryKeyDown(event, `item:${item.id}`, group.id, "item")
                      }
                      tabIndex={effectiveFocusedEntryId === `item:${item.id}` ? 0 : -1}
                      disabled={item.disabled}
                      aria-current={item.active ? "page" : undefined}
                    >
                      {item.icon ? <span className="cc-unified-rail-icon">{item.icon}</span> : null}
                      <span className="cc-unified-rail-label">{item.label}</span>
                      {item.statusLabel ? (
                        <span className={cn("cc-unified-rail-status", `tone-${item.statusTone ?? "neutral"}`)}>
                          {item.statusLabel}
                        </span>
                      ) : item.meta ? (
                        <span className="cc-unified-rail-meta">{item.meta}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
      {footer ? <div className="cc-unified-rail-footer">{footer}</div> : null}
    </aside>
  );
}
