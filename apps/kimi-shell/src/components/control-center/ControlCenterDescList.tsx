import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type ControlCenterDescListItem = {
  label: ReactNode;
  value: ReactNode;
  meta?: ReactNode;
};

type ControlCenterDescListProps = {
  items: ControlCenterDescListItem[];
  columns?: 1 | 2 | 3 | 4;
  className?: string;
};

export function ControlCenterDescList({
  items,
  columns = 2,
  className,
}: ControlCenterDescListProps) {
  return (
    <dl className={cn("cc-desc-list", `columns-${columns}`, className)}>
      {items.map((item, index) => (
        <div key={index} className="cc-desc-list-item">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
          {item.meta ? <small>{item.meta}</small> : null}
        </div>
      ))}
    </dl>
  );
}
