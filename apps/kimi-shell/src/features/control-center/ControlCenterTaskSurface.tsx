import type { ReactNode } from "react";
import { ArrowLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type ControlCenterTaskSurfaceProps = {
  title: string;
  description: string;
  className?: string;
  bodyClassName?: string;
  footerClassName?: string;
  headerActions?: ReactNode;
  footer?: ReactNode;
  onBack: () => void;
  onClose: () => void;
  showCloseButton?: boolean;
  children: ReactNode;
};

export function ControlCenterTaskSurface({
  title,
  description,
  className,
  bodyClassName,
  footerClassName,
  headerActions,
  footer,
  onBack,
  onClose,
  showCloseButton = true,
  children,
}: ControlCenterTaskSurfaceProps) {
  return (
    <section className={`cc-task-surface ${className ?? ""}`.trim()}>
      <header className="cc-task-surface-header">
        <div className="cc-task-surface-title">
          <div className="cc-task-surface-eyebrow">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              icon={<ArrowLeft size={16} />}
              onClick={onBack}
              aria-label={`返回${title}`}
            />
            <span>任务面</span>
          </div>
          <div>
            <h3>{title}</h3>
            <p>{description}</p>
          </div>
        </div>
        <div className="cc-task-surface-header-actions">
          {headerActions}
          {showCloseButton ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              icon={<X size={16} />}
              onClick={onClose}
              aria-label="关闭控制中心"
            />
          ) : null}
        </div>
      </header>
      <div className={`cc-task-surface-body ${bodyClassName ?? ""}`.trim()}>{children}</div>
      {footer ? (
        <footer className={`cc-task-surface-footer ${footerClassName ?? ""}`.trim()}>
          {footer}
        </footer>
      ) : null}
    </section>
  );
}
