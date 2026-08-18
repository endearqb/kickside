import { useEffect, useState } from "react";
import { Copy, QrCode, Radio } from "lucide-react";
import { ask } from "@tauri-apps/plugin-dialog";
import type { LanAccessControllerModel } from "@/app/useLanAccessController";
import { ControlCenterSettingsRow } from "@/components/control-center/ControlCenterSettingsRow";
import { Button } from "@/components/ui/button";
import type { KimiLanLaunchUrl } from "@/services/lanAccessService";

type Props = {
  lanAccess: LanAccessControllerModel;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
};

export function LanAccessSettingsPanel({ lanAccess, expanded, onExpandedChange }: Props) {
  const { status, error, busy } = lanAccess;
  const [launch, setLaunch] = useState<KimiLanLaunchUrl | null>(null);
  const [selectedIp, setSelectedIp] = useState<string | null>(null);
  const external = status?.runtimeOwnership === "reused_external";

  useEffect(() => {
    if (expanded) void lanAccess.refresh();
    else {
      setLaunch(null);
      setSelectedIp(null);
    }
  }, [expanded, lanAccess.refresh]);

  async function toggle(enabled: boolean) {
    setLaunch(null);
    if (enabled) {
      const confirmed = await ask(
        "请仅在可信家庭或办公网络中开启。局域网访问使用 HTTP，切换会重启 Kimi Code，正在执行的任务可能会中断。",
        { title: "开启局域网访问", kind: "warning", okLabel: "开启", cancelLabel: "取消" },
      );
      if (!confirmed) return;
    }
    await lanAccess.toggle(enabled);
  }

  async function reveal(ip: string) {
    const next = await lanAccess.getLaunchUrl(ip);
    if (!next) return;
    setSelectedIp(ip);
    setLaunch(next);
  }

  async function copy(ip: string) {
    const next = await lanAccess.getLaunchUrl(ip);
    if (!next) return;
    await navigator.clipboard.writeText(next.url);
    setLaunch(null);
    setSelectedIp(null);
  }

  return (
    <ControlCenterSettingsRow
      id="lan_access"
      title="局域网访问"
      summary={summary(status)}
      statusTone={status?.enabled ? "success" : external || error ? "warning" : "neutral"}
      icon={<Radio size={18} />}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      className="cc-runtime-settings-row cc-lan-access-settings"
      action={
        <label className="cc-dsh-toggle" title="切换时会重启 Kimi Code">
          <span className="cc-toggle-field-control">
            <input
              type="checkbox"
              className="cc-switch-input"
              aria-label="启用 Kimi Code 局域网访问"
              checked={status?.enabled === true}
              onChange={(event) => void toggle(event.currentTarget.checked)}
              disabled={!status?.canToggle || busy}
            />
            <span className="cc-switch-track" aria-hidden />
          </span>
        </label>
      }
    >
      <div className="cc-settings-detail-stack">
        <p className="hint">允许同一局域网中的手机和电脑访问 Kimi Code。切换时会重启 Kimi Code。</p>
        {external ? (
          <p className="cc-settings-error">当前 Kimi 服务由外部进程管理，KickSide 不会停止或修改它。</p>
        ) : null}
        {status?.enabled ? (
          <p className="cc-settings-error">仅用于可信家庭或办公网络；HTTP 流量不适合公共 Wi-Fi。远程终端、shutdown 与 debug 保持关闭。</p>
        ) : null}
        {error ? <p className="cc-config-error" role="alert">{error}</p> : null}
        {status?.enabled && status.addresses.length === 0 ? (
          <p className="cc-config-error">没有找到可展示的私有 IPv4 地址。请检查 Wi-Fi、企业网络隔离或防火墙设置。</p>
        ) : null}
        {status?.addresses.map((address) => (
          <div className="cc-lan-address-row" key={address.ip}>
            <div>
              <strong>{address.name}</strong>
              <span>{address.url}</span>
            </div>
            <div className="cc-step-secondary-actions">
              <Button type="button" variant="outline" icon={<QrCode size={14} />} className="cc-action-btn" onClick={() => void reveal(address.ip)}>
                显示二维码
              </Button>
              <Button type="button" variant="ghost" icon={<Copy size={14} />} className="cc-action-btn" onClick={() => void copy(address.ip)}>
                复制地址
              </Button>
            </div>
          </div>
        ))}
        {launch && selectedIp ? (
          <div className="cc-lan-qr" role="dialog" aria-label="Kimi Code 局域网二维码">
            <div dangerouslySetInnerHTML={{ __html: launch.qrSvg }} />
            <p>使用同一可信局域网中的设备扫码。关闭后地址会从界面内存中清除。</p>
            <Button type="button" variant="outline" className="cc-action-btn" onClick={() => { setLaunch(null); setSelectedIp(null); }}>
              关闭二维码
            </Button>
          </div>
        ) : null}
      </div>
    </ControlCenterSettingsRow>
  );
}

function summary(status: LanAccessControllerModel["status"]) {
  if (!status) return "正在读取状态";
  if (status.switching) return "正在重启 Kimi Code";
  if (status.runtimeOwnership === "reused_external") return "外部进程管理 · 无法切换";
  if (!status.runtimeReady) return "Kimi Code 尚未运行";
  if (status.enabled) return status.addresses[0]?.ip ? `已开启 · ${status.addresses[0].ip}` : "已开启 · 等待网络地址";
  return "已关闭 · 仅本机访问";
}
