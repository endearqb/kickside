import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

type ControlCenterModalShellProps = {
  open: boolean;
  title: string;
  description: string;
  ariaLabel?: string;
  className?: string;
  bodyClassName?: string;
  footerClassName?: string;
  headerActions?: ReactNode;
  footer?: ReactNode;
  onRequestClose: () => void;
  children: ReactNode;
};

export function ControlCenterModalShell({
  open,
  title,
  description,
  ariaLabel,
  className,
  bodyClassName,
  footerClassName,
  headerActions,
  footer,
  onRequestClose,
  children,
}: ControlCenterModalShellProps) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onRequestClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onRequestClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="cc-modal-shell-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onRequestClose();
        }
      }}
    >
      <section
        className={`cc-modal-shell ${className ?? ""}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? title}
      >
        <header className="cc-modal-shell-header">
          <div className="cc-modal-shell-title">
            <h3>{title}</h3>
            <p>{description}</p>
          </div>
          <div className="cc-modal-shell-header-actions">
            {headerActions}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              icon={<X size={16} />}
              onClick={onRequestClose}
              aria-label={`关闭${title}`}
            />
          </div>
        </header>
        <div className={`cc-modal-shell-body ${bodyClassName ?? ""}`.trim()}>{children}</div>
        {footer ? (
          <footer className={`cc-modal-shell-footer ${footerClassName ?? ""}`.trim()}>
            {footer}
          </footer>
        ) : null}
      </section>
    </div>
  );
}
