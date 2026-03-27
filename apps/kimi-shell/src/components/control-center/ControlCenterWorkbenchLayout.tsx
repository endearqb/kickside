import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type ControlCenterWorkbenchLayoutProps = {
  railHeader: ReactNode;
  rail: ReactNode;
  detail: ReactNode | null;
  detailHeader?: ReactNode;
  emptyDetail?: ReactNode;
  mode: "persistent" | "stack-on-mobile";
  className?: string;
  railClassName?: string;
  railBodyClassName?: string;
  detailClassName?: string;
  detailBodyClassName?: string;
};

export function ControlCenterWorkbenchLayout({
  railHeader,
  rail,
  detail,
  detailHeader,
  emptyDetail,
  mode,
  className,
  railClassName,
  railBodyClassName,
  detailClassName,
  detailBodyClassName,
}: ControlCenterWorkbenchLayoutProps) {
  return (
    <section className={cn("cc-workbench-layout", `mode-${mode}`, className)}>
      <aside className={cn("cc-workbench-rail", railClassName)}>
        <div className="cc-workbench-rail-header">{railHeader}</div>
        <div className={cn("cc-workbench-rail-body", railBodyClassName)}>{rail}</div>
      </aside>
      <section className={cn("cc-workbench-detail", detailClassName)}>
        {detailHeader ? <div className="cc-workbench-detail-header">{detailHeader}</div> : null}
        <div className={cn("cc-workbench-detail-body", detailBodyClassName)}>
          {detail ?? emptyDetail ?? null}
        </div>
      </section>
    </section>
  );
}
