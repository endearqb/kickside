import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ControlCenterSegmentedItem<T extends string> = {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
};

type ControlCenterSegmentedControlProps<T extends string> = {
  items: Array<ControlCenterSegmentedItem<T>>;
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
  itemClassName?: string;
};

export function ControlCenterSegmentedControl<T extends string>({
  items,
  value,
  onChange,
  disabled = false,
  ariaLabel,
  className,
  itemClassName,
}: ControlCenterSegmentedControlProps<T>) {
  return (
    <div className={cn("cc-segmented-control", className)} role="group" aria-label={ariaLabel}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            className={cn(
              "cc-segmented-control-item",
              active && "is-active",
              Boolean(item.description) && "has-description",
              itemClassName,
            )}
            onClick={() => onChange(item.value)}
            disabled={disabled || item.disabled}
            aria-pressed={active}
          >
            <span className="cc-segmented-control-label">{item.label}</span>
            {item.description ? (
              <small className="cc-segmented-control-description">{item.description}</small>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

