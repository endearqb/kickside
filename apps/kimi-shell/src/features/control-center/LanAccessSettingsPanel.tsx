import { useEffect, useState } from "react";
import { Copy, ExternalLink, QrCode, Radio } from "lucide-react";
import { ask } from "@tauri-apps/plugin-dialog";
import type { LanAccessControllerModel } from "@/app/useLanAccessController";
import { ControlCenterSettingsRow } from "@/components/control-center/ControlCenterSettingsRow";
import { Button } from "@/components/ui/button";
import type { KimiAccessMode, KimiLanLaunchUrl, KimiRemoteLaunchUrl } from "@/services/lanAccessService";

type Props = {
  lanAccess: LanAccessControllerModel;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onOpenExternalUrl?: (url: string) => void;
};

type LaunchProjection =
  | { kind: "lan"; value: KimiLanLaunchUrl; ip: string }
  | { kind: "remote"; value: KimiRemoteLaunchUrl };

const MODES: Array<{ mode: KimiAccessMode; title: string; detail: string }> = [
  { mode: "local", title: "仅本机", detail: "只在当前 KickSide 中访问" },
  { mode: "lan", title: "局域网", detail: "供同一可信网络中的设备访问" },
  { mode: "kimi_remote", title: "Kimi 官方远程（实验）", detail: "通过 Kimi 官方服务从互联网访问" },
];

export function LanAccessSettingsPanel({ lanAccess, expanded, onExpandedChange, onOpenExternalUrl }: Props) {
  const { status, error, busy } = lanAccess;
  const [launch, setLaunch] = useState<LaunchProjection | null>(null);
  const external = status?.runtimeOwnership === "reused_external";

  useEffect(() => {
    if (expanded) void lanAccess.refresh();
    else setLaunch(null);
  }, [expanded, lanAccess.refresh]);
  useEffect(() => setLaunch(null), [status?.mode]);

  async function selectMode(mode: KimiAccessMode) {
    if (!status || status.mode === mode) return;
    setLaunch(null);
    if (mode === "lan") {
      const confirmed = await ask(
        "请仅在可信家庭或办公网络中开启。切换会重启 Kimi Code，正在执行的任务可能会中断。",
        { title: "开启局域网访问", kind: "warning", okLabel: "开启", cancelLabel: "取消" },
      );
      if (!confirmed) return;
    }
    if (mode === "kimi_remote") {
      const confirmed = await ask(
        "远程操作会访问当前电脑上的项目与工具。本地电脑需保持开机、联网并运行 KickSide。",
        { title: "开启 Kimi 官方远程", kind: "warning", okLabel: "开启", cancelLabel: "取消" },
      );
      if (!confirmed) return;
    }
    await lanAccess.setMode(mode);
  }

  async function revealLan(ip: string) {
    const value = await lanAccess.getLaunchUrl(ip);
    if (value) setLaunch({ kind: "lan", value, ip });
  }
  async function copyLan(ip: string) {
    const value = await lanAccess.getLaunchUrl(ip);
    if (!value) return;
    await navigator.clipboard.writeText(value.url);
    setLaunch(null);
  }
  async function revealRemote() {
    const value = await lanAccess.getRemoteLaunchUrl();
    if (value) setLaunch({ kind: "remote", value });
  }
  async function copyRemote() {
    const value = await lanAccess.getRemoteLaunchUrl();
    if (!value) return;
    await navigator.clipboard.writeText(value.url);
    setLaunch(null);
  }
  async function openRemote() {
    const value = await lanAccess.getRemoteLaunchUrl();
    if (value) onOpenExternalUrl?.(value.url);
  }

  return (
    <ControlCenterSettingsRow
      id="lan_access"
      title="Kimi 访问方式"
      summary={summary(status)}
      statusTone={tone(status, error)}
      icon={<Radio size={18} />}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      className="cc-runtime-settings-row cc-lan-access-settings"
    >
      <div className="cc-settings-detail-stack">
        <div className="cc-kimi-access-modes" role="radiogroup" aria-label="Kimi 访问方式">
          {MODES.map((option) => {
            const unavailable = option.mode === "kimi_remote" && status?.remoteControlSupported !== true;
            return (
              <button
                key={option.mode}
                type="button"
                role="radio"
                aria-checked={status?.mode === option.mode}
                className={`cc-kimi-access-mode ${status?.mode === option.mode ? "is-selected" : ""}`}
                disabled={!status?.canChange || busy || unavailable}
                onClick={() => void selectMode(option.mode)}
              >
                <span>{option.title}</span>
                <small>{unavailable ? "当前 Kimi Code 版本不支持，请先升级" : option.detail}</small>
              </button>
            );
          })}
        </div>
        {external ? <p className="cc-settings-warning">当前 Kimi 服务由外部进程管理，KickSide 不会停止或修改它。</p> : null}
        {error ? <p className="cc-config-error" role="alert">{error}</p> : null}

        {status?.mode === "lan" ? (
          <>
            <p className="cc-settings-warning">仅用于可信网络；HTTP 流量不适合公共 Wi-Fi。</p>
            {status.lanAddresses.length === 0 ? <p className="cc-config-error">没有找到可展示的私有 IPv4 地址。</p> : null}
            {status.lanAddresses.map((address) => (
              <div className="cc-lan-address-row" key={address.ip}>
                <div><strong>{address.name}</strong><span>{address.url}</span></div>
                <div className="cc-step-secondary-actions">
                  <Button type="button" variant="outline" icon={<QrCode size={14} />} className="cc-action-btn" onClick={() => void revealLan(address.ip)}>显示二维码</Button>
                  <Button type="button" variant="ghost" icon={<Copy size={14} />} className="cc-action-btn" onClick={() => void copyLan(address.ip)}>复制地址</Button>
                </div>
              </div>
            ))}
          </>
        ) : null}

        {status?.mode === "kimi_remote" ? (
          <div className="cc-kimi-remote-detail">
            <p className="hint">远程流量由 Kimi 官方服务转发，本地代码和命令仍在当前电脑处理。</p>
            {status.remoteControlState === "connected" && status.remoteUrlAvailable ? (
              <div className="cc-step-secondary-actions">
                <Button type="button" variant="outline" icon={<QrCode size={14} />} className="cc-action-btn" onClick={() => void revealRemote()}>显示二维码</Button>
                <Button type="button" variant="ghost" icon={<Copy size={14} />} className="cc-action-btn" onClick={() => void copyRemote()}>复制地址</Button>
                <Button type="button" variant="ghost" icon={<ExternalLink size={14} />} className="cc-action-btn" onClick={() => void openRemote()}>在浏览器打开</Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {launch ? (
          <div className="cc-lan-qr" role="dialog" aria-label={launch.kind === "lan" ? "Kimi Code 局域网二维码" : "Kimi 官方远程二维码"}>
            <div dangerouslySetInnerHTML={{ __html: launch.value.qrSvg }} />
            <p>{launch.kind === "lan" ? `使用同一可信局域网中的设备扫码（${launch.ip}）。` : "使用已登录 Kimi 账户的设备扫码。"}</p>
            <Button type="button" variant="outline" className="cc-action-btn" onClick={() => setLaunch(null)}>关闭二维码</Button>
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
  if (status.mode === "lan") return status.lanAddresses[0]?.ip ? `局域网 · ${status.lanAddresses[0].ip}` : "局域网 · 等待网络地址";
  if (status.mode === "kimi_remote") return `Kimi 官方远程 · ${remoteStateLabel(status.remoteControlState)}`;
  return "仅本机";
}

function remoteStateLabel(state: NonNullable<LanAccessControllerModel["status"]>["remoteControlState"]) {
  switch (state) {
    case "connected": return "运行中";
    case "registering": return "正在连接";
    case "starting": return "正在启动";
    case "disconnected": return "连接已断开";
    case "error": return "错误";
    default: return "已停止";
  }
}

function tone(status: LanAccessControllerModel["status"], error: string | null) {
  if (error || status?.remoteControlState === "error") return "warning" as const;
  if (status?.mode === "lan" || status?.remoteControlState === "connected") return "success" as const;
  return "neutral" as const;
}
