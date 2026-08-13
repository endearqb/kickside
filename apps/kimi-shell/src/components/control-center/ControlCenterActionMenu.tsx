import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
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
  triggerContent?: ReactNode;
  triggerIcon?: ReactNode;
};

export function ControlCenterActionMenu({
  label = "更多操作",
  items,
  disabled,
  className,
  triggerContent,
  triggerIcon,
}: ControlCenterActionMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  function menuItems() {
    return Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [],
    );
  }

  function closeMenu({ restoreFocus = false } = {}) {
    setOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLElement>) {
    const items = menuItems();
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu({ restoreFocus: true });
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || items.length === 0) {
      return;
    }

    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowUp"
          ? (currentIndex <= 0 ? items.length - 1 : currentIndex - 1)
          : (currentIndex + 1) % items.length;
    items[nextIndex]?.focus();
  }

  useEffect(() => {
    if (!open) return;

    const focusFrame = window.requestAnimationFrame(() => menuItems()[0]?.focus());
    function dismissOnOutsidePointer(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      closeMenu();
    }

    document.addEventListener("pointerdown", dismissOnOutsidePointer);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", dismissOnOutsidePointer);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={cn("cc-action-menu", className)}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
          setOpen(false);
        }
      }}
    >
      <Button
        ref={triggerRef}
        type="button"
        variant={triggerContent ? "default" : "ghost"}
        size={triggerContent ? "sm" : "icon-sm"}
        icon={triggerIcon ?? <MoreHorizontal size={16} />}
        className="cc-action-menu-trigger"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            setOpen(true);
            return;
          }
          handleMenuKeyDown(event);
        }}
        disabled={disabled || items.length === 0}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
      >
        {triggerContent}
      </Button>
      {open ? (
        <div
          className="cc-action-menu-popover"
          role="menu"
          aria-label={label}
          onKeyDown={handleMenuKeyDown}
        >
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
                closeMenu({ restoreFocus: true });
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
