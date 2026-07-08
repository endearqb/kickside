import type { ReactNode } from "react";
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
  onItemActivate?: (itemId: string, groupId: string) => void;
  footer?: ReactNode;
};

export function ControlCenterUnifiedRail({
  title,
  groups,
  expandedGroups,
  onToggleGroup,
  onExit,
  onItemActivate,
  footer,
}: ControlCenterUnifiedRailProps) {
  return (
    <aside className="cc-unified-rail" aria-label="控制中心导航与对象列表">
      <div className="cc-unified-rail-head">
        <h2>{title}</h2>
        {onExit ? (
          <button type="button" className="cc-unified-rail-exit" onClick={onExit}>
            退出
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
                  type="button"
                  className="cc-unified-rail-group-head"
                  onClick={() => onToggleGroup(group.id)}
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
