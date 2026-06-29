import { cn } from "@/lib/utils";

type KimiCodeBrandProps = {
  className?: string;
  compact?: boolean;
  withSubtitle?: boolean;
  subtitle?: string;
};

export function KimiCodeBrand({
  className,
  compact = false,
  withSubtitle = false,
  subtitle = "Desktop Shell",
}: KimiCodeBrandProps) {
  return (
    <div className={cn("kimi-brand", compact && "compact", className)}>
      <img src="/kimilogo.png" alt="Kimi" width={compact ? 20 : 24} height={compact ? 20 : 24} className="kimi-brand-logo" />
      <div className="kimi-brand-text">
        <span className="kimi-brand-title">Kimi Code</span>
        {withSubtitle ? <span className="kimi-brand-subtitle">{subtitle}</span> : null}
      </div>
    </div>
  );
}
