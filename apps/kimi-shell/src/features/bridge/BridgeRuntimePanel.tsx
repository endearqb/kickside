import {
  FolderOpen,
  Play,
  RefreshCcw,
  RefreshCw,
  Square,
  Trash2,
} from "lucide-react";
import type {
  BindingRecord,
  BridgePlatform,
  BridgeSettings,
  BridgeStatus,
} from "@/app/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type BridgeRuntimePanelProps = {
  settings: BridgeSettings;
  status: BridgeStatus;
  bindings: BindingRecord[];
  busy: boolean;
  onSettingsChange: (next: BridgeSettings) => void;
  onSave: () => Promise<void>;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onRestart: () => Promise<void>;
  onRefreshStatus: () => Promise<BridgeStatus>;
  onRefreshBindings: () => Promise<BindingRecord[]>;
  onOpenLogs: () => Promise<void>;
  onClearBinding: (bindingId: string) => Promise<void>;
};

function updateChannelEnabled(
  settings: BridgeSettings,
  platform: BridgePlatform,
  enabled: boolean,
): BridgeSettings {
  return {
    ...settings,
    channels: settings.channels.map((channel) =>
      channel.platform === platform
        ? {
            ...channel,
            enabled,
          }
        : channel,
    ),
  };
}

function platformLabel(platform: BridgePlatform): string {
  return platform === "telegram" ? "Telegram" : "Feishu";
}

export function BridgeRuntimePanel({
  settings,
  status,
  bindings,
  busy,
  onSettingsChange,
  onSave,
  onStart,
  onStop,
  onRestart,
  onRefreshStatus,
  onRefreshBindings,
  onOpenLogs,
  onClearBinding,
}: BridgeRuntimePanelProps) {
  const isRunning =
    status.state === "running" ||
    status.state === "starting" ||
    status.state === "degraded";

  return (
    <div className="bridge-panel">
      <div className="bridge-panel-section">
        <div className="bridge-panel-header">
          <div>
            <h4>Bridge runtime</h4>
            <p>管理 sidecar 进程、端口和渠道启停状态。</p>
          </div>
          <div className="cc-actions">
            <Button
              type="button"
              icon={<RefreshCw size={15} />}
              className="cc-action-btn"
              onClick={() => void onRefreshStatus()}
              disabled={busy}
            >
              刷新状态
            </Button>
            <Button
              type="button"
              variant="ghost"
              icon={<RefreshCcw size={15} />}
              className="cc-action-btn"
              onClick={() => void onRefreshBindings()}
              disabled={busy}
            >
              刷新绑定
            </Button>
            <Button
              type="button"
              variant="ghost"
              icon={<FolderOpen size={15} />}
              className="cc-action-btn"
              onClick={() => void onOpenLogs()}
            >
              打开日志目录
            </Button>
          </div>
        </div>

        <div className="bridge-settings-grid">
          <label className="bridge-switch-card">
            <span className="bridge-switch-copy">
              <strong>Enable bridge</strong>
              <small>保存后写入 `bridge_settings.json`。</small>
            </span>
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(event) =>
                onSettingsChange({
                  ...settings,
                  enabled: event.currentTarget.checked,
                })
              }
            />
          </label>

          <label className="bridge-switch-card">
            <span className="bridge-switch-copy">
              <strong>Auto start</strong>
              <small>Shell setup 完成后异步启动，不阻塞窗口。</small>
            </span>
            <input
              type="checkbox"
              checked={settings.autoStart}
              onChange={(event) =>
                onSettingsChange({
                  ...settings,
                  autoStart: event.currentTarget.checked,
                })
              }
            />
          </label>

          <label className="bridge-port-card">
            <span>Admin Port</span>
            <Input
              value={String(settings.adminPort)}
              onChange={(event) =>
                onSettingsChange({
                  ...settings,
                  adminPort: Number(event.currentTarget.value) || 60110,
                })
              }
              inputMode="numeric"
            />
          </label>
        </div>

        <div className="bridge-channel-list">
          {settings.channels.map((channel) => (
            <label key={channel.platform} className="bridge-channel-card">
              <div className="bridge-channel-copy">
                <strong>{platformLabel(channel.platform)}</strong>
                <small>mode: {channel.mode}</small>
              </div>
              <input
                type="checkbox"
                checked={channel.enabled}
                onChange={(event) =>
                  onSettingsChange(
                    updateChannelEnabled(
                      settings,
                      channel.platform,
                      event.currentTarget.checked,
                    ),
                  )
                }
              />
            </label>
          ))}
        </div>

        <div className="cc-actions">
          <Button
            type="button"
            icon={<RefreshCw size={15} />}
            className="cc-action-btn"
            onClick={() => void onSave()}
            disabled={busy}
          >
            保存配置
          </Button>
          <Button
            type="button"
            icon={<Play size={15} />}
            className="cc-action-btn"
            onClick={() => void onStart()}
            disabled={busy || isRunning}
          >
            Start
          </Button>
          <Button
            type="button"
            variant="ghost"
            icon={<Square size={15} />}
            className="cc-action-btn"
            onClick={() => void onStop()}
            disabled={busy || !isRunning}
          >
            Stop
          </Button>
          <Button
            type="button"
            variant="outline"
            icon={<RefreshCcw size={15} />}
            className="cc-action-btn"
            onClick={() => void onRestart()}
            disabled={busy}
          >
            Restart
          </Button>
        </div>
      </div>

      <div className="bridge-panel-section">
        <div className="bridge-panel-header">
          <div>
            <h4>Status</h4>
            <p>当前 bridge 运行态与 sidecar 汇总信息。</p>
          </div>
          <span className={`bridge-state-chip bridge-state-${status.state}`}>
            {status.state}
          </span>
        </div>
        <div className="diagnostics-grid">
          <div className="diag-item">
            <span className="diag-label">PID</span>
            <strong>{status.pid ?? "-"}</strong>
          </div>
          <div className="diag-item">
            <span className="diag-label">Version</span>
            <strong>{status.version ?? "-"}</strong>
          </div>
          <div className="diag-item">
            <span className="diag-label">Admin Port</span>
            <strong>{status.adminPort}</strong>
          </div>
          <div className="diag-item">
            <span className="diag-label">Bindings</span>
            <strong>{status.bindings}</strong>
          </div>
          <div className="diag-item">
            <span className="diag-label">Pending Approvals</span>
            <strong>{status.pendingApprovals}</strong>
          </div>
          <div className="diag-item">
            <span className="diag-label">Started At</span>
            <strong>{status.startedAt ?? "-"}</strong>
          </div>
        </div>
        {status.lastError ? (
          <p className="bridge-error-text">{status.lastError}</p>
        ) : null}
        <div className="bridge-channel-statuses">
          {status.channels.length > 0 ? (
            status.channels.map((channel) => (
              <div key={channel.platform} className="bridge-channel-status-card">
                <strong>{platformLabel(channel.platform)}</strong>
                <span>{channel.state}</span>
                <small>
                  offset: {channel.lastOffset ?? "-"}
                  {channel.lastError ? ` | error: ${channel.lastError}` : ""}
                </small>
              </div>
            ))
          ) : (
            <p className="hint">bridge 未运行时不会返回实时 channel 状态。</p>
          )}
        </div>
      </div>

      <div className="bridge-panel-section">
        <div className="bridge-panel-header">
          <div>
            <h4>Bindings</h4>
            <p>Phase 1 只支持查看与清理现有 binding。</p>
          </div>
        </div>
        {bindings.length > 0 ? (
          <div className="bridge-binding-list">
            {bindings.map((binding) => (
              <div key={binding.bindingId} className="bridge-binding-card">
                <div className="bridge-binding-copy">
                  <strong>{binding.bindingId}</strong>
                  <span>
                    {platformLabel(binding.platform)} / {binding.chatId}
                    {binding.threadId ? ` / ${binding.threadId}` : ""}
                  </span>
                  <small>
                    session {binding.kimiSessionId}
                    {binding.lastInboundMessageId
                      ? ` | last inbound ${binding.lastInboundMessageId}`
                      : ""}
                  </small>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  icon={<Trash2 size={14} />}
                  className="cc-action-btn"
                  onClick={() => void onClearBinding(binding.bindingId)}
                  disabled={busy}
                >
                  Clear
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="hint">暂无 bindings。bridge 停止时列表会显示为空。</p>
        )}
      </div>
    </div>
  );
}
