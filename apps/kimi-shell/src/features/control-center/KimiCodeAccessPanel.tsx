import { SlidersHorizontal } from "lucide-react";
import {
  formatAuthMode,
  formatKimiLoginHealthSource,
  formatKimiLoginHealthState,
  formatProviderApiHealthSource,
  formatProviderApiHealthState,
  type AuthMode,
  type KimiLoginHealth,
  type ProviderApiHealth,
} from "@/app/types";
import { Button } from "@/components/ui/button";

type KimiCodeAccessTaskContentProps = {
  authMode?: AuthMode;
  activeProvider?: string;
  providerApiConfigured: boolean;
  kimiLoginHealth?: KimiLoginHealth;
  providerApiHealth?: ProviderApiHealth;
  onOpenKimiCodeSettings: () => void;
};

function formatCheckedAt(value?: number): string {
  return value
    ? new Date(value).toLocaleString("zh-CN", { hour12: false })
    : "尚未检查";
}

export function KimiCodeAccessTaskContent({
  authMode,
  activeProvider,
  providerApiConfigured,
  kimiLoginHealth,
  providerApiHealth,
  onOpenKimiCodeSettings,
}: KimiCodeAccessTaskContentProps) {
  return (
    <div className="cc-settings-detail-stack">
      <p className="hint">
        API、模型与 Search / Fetch 服务配置请在 Kimi Code Web
        内置设置中完成；返回工作区后打开“设置”。
      </p>
      <dl className="cc-app-update-meta">
        <div>
          <dt>当前认证模式</dt>
          <dd>{formatAuthMode(authMode)}</dd>
        </div>
        <div>
          <dt>Kimi 登录</dt>
          <dd>
            {formatKimiLoginHealthState(kimiLoginHealth?.state)} ·{" "}
            {kimiLoginHealth
              ? formatKimiLoginHealthSource(kimiLoginHealth.source)
              : "尚未检查"}
          </dd>
        </div>
        <div>
          <dt>Provider API</dt>
          <dd>
            {providerApiConfigured
              ? formatProviderApiHealthState(providerApiHealth?.state)
              : "未配置"}
            {activeProvider ? ` · ${activeProvider}` : ""}
          </dd>
        </div>
      </dl>
      <div aria-label="认证诊断">
        <p className="hint">
          Kimi 登录 · {formatCheckedAt(kimiLoginHealth?.checkedAtMs)} ·{" "}
          {kimiLoginHealth?.message || "暂无诊断信息"}
        </p>
        <p className="hint">
          Provider API ·{" "}
          {providerApiHealth
            ? formatProviderApiHealthSource(providerApiHealth.source)
            : "尚未检查"}{" "}
          · {formatCheckedAt(providerApiHealth?.checkedAtMs)} ·{" "}
          {providerApiHealth?.message || "暂无诊断信息"}
        </p>
      </div>
      <div className="cc-settings-more-actions">
        <Button
          type="button"
          icon={<SlidersHorizontal size={15} />}
          className="cc-action-btn"
          onClick={onOpenKimiCodeSettings}
        >
          返回 Kimi Code Web
        </Button>
      </div>
    </div>
  );
}
