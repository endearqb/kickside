import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type ControlCenterSettingsRowTone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "accent";

type ControlCenterSettingsRowProps = {
  id: string;
  domId?: string;
  title: ReactNode;
  summary: ReactNode;
  statusTone: ControlCenterSettingsRowTone;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  icon?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  focused?: boolean;
};

export function ControlCenterSettingsRow({
  id,
  domId,
  title,
  summary,
  statusTone,
  expanded,
  onExpandedChange,
  icon,
  action,
  children,
  className,
  focused = false,
}: ControlCenterSettingsRowProps) {
  const detailId = `cc-settings-detail-${id}`;

  return (
    <li
      id={domId ?? `cc-settings-row-${id}`}
      className={cn(
        "cc-image-row cc-settings-bar cc-settings-disclosure-row",
        expanded && "is-expanded",
        focused && "is-focus",
        className,
      )}
      data-settings-row={id}
    >
      <div className="cc-settings-bar-head">
        <button
          type="button"
          className="cc-settings-bar-toggle"
          onClick={() => onExpandedChange(!expanded)}
          aria-expanded={expanded}
          aria-controls={detailId}
        >
          <span className="cc-settings-row-copy">
            <span className="cc-image-row-title">
              <span className={`cc-dot ${statusTone}`} />
              {icon}
              <span>{title}</span>
            </span>
            <span className="cc-image-row-desc">{summary}</span>
          </span>
          <ChevronRight
            size={16}
            className={cn("cc-settings-bar-chevron", expanded && "is-expanded")}
            aria-hidden="true"
          />
        </button>
        {action ? (
          <div className="cc-image-row-actions cc-settings-row-action">{action}</div>
        ) : null}
      </div>
      {expanded ? (
        <div id={detailId} className="cc-settings-bar-detail">
          {children}
        </div>
      ) : null}
    </li>
  );
}
