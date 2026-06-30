import { cn } from "@/lib/utils";
import { getKimiAssistantDisplayName } from "@/lib/appBrand";

type KimiBrandProps = {
  className?: string;
  compact?: boolean;
  withSubtitle?: boolean;
  subtitle?: string;
};

export function KimiAssistantBrand({
  className,
  compact = false,
  withSubtitle = false,
  subtitle = "kimi sidekick",
}: KimiBrandProps) {
  const displayName = getKimiAssistantDisplayName();

  return (
    <div className={cn("kimi-brand", compact && "compact", className)}>
      <img src="/kimilogo.png" alt="Kimi" width={compact ? 20 : 24} height={compact ? 20 : 24} className="kimi-brand-logo" />
      <div className="kimi-brand-text">
        <span className="kimi-brand-title">{displayName}</span>
        {withSubtitle ? <span className="kimi-brand-subtitle">{subtitle}</span> : null}
      </div>
    </div>
  );
}

export function KimiCodeBrand({
  className,
  compact = false,
  withSubtitle = false,
  subtitle = "Runtime",
}: KimiBrandProps) {
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
