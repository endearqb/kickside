import { useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type ControlCenterActionMenuItem = {
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  tone?: "default" | "danger";
  onSelect: () => void;
};

type ControlCenterActionMenuProps = {
  label?: string;
  items: ControlCenterActionMenuItem[];
  disabled?: boolean;
  className?: string;
};

export function ControlCenterActionMenu({
  label = "更多操作",
  items,
  disabled,
  className,
}: ControlCenterActionMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={cn("cc-action-menu", className)}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
          setOpen(false);
        }
      }}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        icon={<MoreHorizontal size={16} />}
        className="cc-action-menu-trigger"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled || items.length === 0}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
      />
      {open ? (
        <div className="cc-action-menu-popover" role="menu" aria-label={label}>
          {items.map((item, index) => (
            <button
              key={index}
              type="button"
              className={cn(
                "cc-action-menu-item",
                item.tone === "danger" ? "tone-danger" : null,
              )}
              onClick={() => {
                item.onSelect();
                setOpen(false);
              }}
              disabled={item.disabled}
              role="menuitem"
            >
              {item.icon ? <span className="cc-action-menu-item-icon">{item.icon}</span> : null}
              <span className="cc-action-menu-item-copy">
                <strong>{item.label}</strong>
                {item.description ? <small>{item.description}</small> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
