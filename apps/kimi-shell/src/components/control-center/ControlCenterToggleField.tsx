import { cn } from "@/lib/utils";

type ControlCenterToggleFieldProps = {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  busy?: boolean;
  tone?: "default" | "danger";
  className?: string;
};

export function ControlCenterToggleField({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  busy = false,
  tone = "default",
  className,
}: ControlCenterToggleFieldProps) {
  return (
    <label className={cn("cc-toggle-field", `tone-${tone}`, className)}>
      <span className="cc-toggle-field-copy">
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <span className="cc-toggle-field-control">
        <input
          type="checkbox"
          className="cc-switch-input"
          checked={checked}
          onChange={(event) => onChange(event.currentTarget.checked)}
          disabled={disabled || busy}
        />
        <span className="cc-switch-track" aria-hidden />
      </span>
    </label>
  );
}
