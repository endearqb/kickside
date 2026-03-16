import {
  Check,
  FolderOpen,
  Play,
  RefreshCcw,
  RefreshCw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type {
  BindingRecord,
  BridgeApprovalRecord,
  BridgeApprovalResolveInput,
  BridgePlatform,
  BridgeSecretsMaskView,
  BridgeSettings,
  BridgeStatus,
} from "@/app/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type BridgeRuntimePanelProps = {
  settings: BridgeSettings;
  status: BridgeStatus;
  bindings: BindingRecord[];
  approvals: BridgeApprovalRecord[];
  logTail: string[];
  recentErrors: string[];
  secretsMask: BridgeSecretsMaskView;
  busy: boolean;
  onSettingsChange: (next: BridgeSettings) => void;
  onSave: () => Promise<void>;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onRestart: () => Promise<void>;
  onRefreshStatus: () => Promise<BridgeStatus>;
  onRefreshBindings: () => Promise<BindingRecord[]>;
  onRefreshApprovals: () => Promise<BridgeApprovalRecord[]>;
  onRefreshLogTail: () => Promise<string[]>;
  onRefreshSecretsMask: () => Promise<BridgeSecretsMaskView>;
  onOpenLogs: () => Promise<void>;
  onClearBinding: (bindingId: string) => Promise<void>;
  onResolveApproval: (
    approvalId: string,
    status: BridgeApprovalResolveInput["status"],
  ) => Promise<void>;
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

function formatTimestamp(value?: string): string {
  if (!value) {
    return "-";
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }
  return new Date(timestamp).toLocaleString("zh-CN", {
    hour12: false,
  });
}

function renderSecretRow(label: string, value: BridgeSecretsMaskView["telegram"]["botToken"]) {
  return (
    <div key={label} className="bridge-secret-row">
      <div className="bridge-secret-copy">
        <strong>{label}</strong>
        <small>{value.configured ? value.maskedValue ?? "***" : "未配置"}</small>
      </div>
      <span className={`bridge-secret-chip ${value.configured ? "configured" : "empty"}`}>
        {value.configured ? "Configured" : "Missing"}
      </span>
    </div>
  );
}

function formatErrorLine(errorCode?: string, message?: string): string {
  const parts: string[] = [];
  if (errorCode) {
    parts.push(`[${errorCode}]`);
  }
  if (message) {
    parts.push(message);
  }
  return parts.join(" ").trim();
}

export function BridgeRuntimePanel({
  settings,
  status,
  bindings,
  approvals,
  logTail,
  recentErrors,
  secretsMask,
  busy,
  onSettingsChange,
  onSave,
  onStart,
  onStop,
  onRestart,
  onRefreshStatus,
  onRefreshBindings,
  onRefreshApprovals,
  onRefreshLogTail,
  onRefreshSecretsMask,
  onOpenLogs,
  onClearBinding,
  onResolveApproval,
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

        <div className="bridge-panel-group">
          <div className="bridge-panel-group-label">
            <span>常规配置</span>
            <small>轻量运行配置可直接在卡内完成。</small>
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

          <div className="bridge-action-row">
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
          </div>
        </div>

        <div className="bridge-danger-group">
          <div className="bridge-panel-group-label is-danger">
            <span>危险操作</span>
            <small>会中断运行中的 bridge 或触发重连。</small>
          </div>
          <div className="bridge-action-row">
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
        {status.lastError || status.lastErrorCode ? (
          <p className="bridge-error-text">
            {formatErrorLine(status.lastErrorCode, status.lastError)}
          </p>
        ) : null}
        <div className="bridge-channel-statuses">
          {status.channels.length > 0 ? (
            status.channels.map((channel) => (
              <div key={channel.platform} className="bridge-channel-status-card">
                <strong>{platformLabel(channel.platform)}</strong>
                <span>{channel.state}</span>
                <small>
                  offset: {channel.lastOffset ?? "-"}
                  {channel.lastError || channel.lastErrorCode
                    ? ` | error: ${formatErrorLine(channel.lastErrorCode, channel.lastError)}`
                    : ""}
                </small>
              </div>
            ))
          ) : (
            <p className="hint">bridge 未运行时不会返回实时 channel 状态。</p>
          )}
        </div>
        <div className="bridge-panel-subsection">
          <div className="bridge-panel-subheader">
            <h5>最近错误摘要</h5>
          </div>
          {recentErrors.length > 0 ? (
            <div className="bridge-error-list">
              {recentErrors.map((entry) => (
                <div key={entry} className="bridge-error-card">
                  {entry}
                </div>
              ))}
            </div>
          ) : (
            <p className="hint">最近没有采集到 bridge 错误摘要。</p>
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
          <>
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
                </div>
              ))}
            </div>
            <div className="bridge-danger-group">
              <div className="bridge-panel-group-label is-danger">
                <span>危险操作</span>
                <small>清理 binding 会断开当前会话映射。</small>
              </div>
              <div className="bridge-danger-action-list">
                {bindings.map((binding) => (
                  <Button
                    key={`clear-${binding.bindingId}`}
                    type="button"
                    variant="ghost"
                    icon={<Trash2 size={14} />}
                    className="cc-action-btn"
                    onClick={() => void onClearBinding(binding.bindingId)}
                    disabled={busy}
                  >
                    Clear {binding.bindingId}
                  </Button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <p className="hint">暂无 bindings。bridge 停止时列表会显示为空。</p>
        )}
      </div>

      <div className="bridge-panel-section">
        <div className="bridge-panel-header">
          <div>
            <h4>Pending Approvals</h4>
            <p>默认展示 pending approval，并支持从控制中心直接处理。</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            icon={<RefreshCcw size={15} />}
            className="cc-action-btn"
            onClick={() => void onRefreshApprovals()}
            disabled={busy}
          >
            刷新审批
          </Button>
        </div>
        {approvals.length > 0 ? (
          <>
            <div className="bridge-approval-list">
              {approvals.map((approval) => (
                <div key={approval.approvalId} className="bridge-approval-card">
                  <div className="bridge-approval-copy">
                    <strong>{approval.approvalId}</strong>
                    <span>
                      {platformLabel(approval.platform)} / {approval.kimiSessionId}
                    </span>
                    <small>
                      {approval.requestKind} | {approval.chatId}
                      {approval.threadId ? ` / ${approval.threadId}` : ""}
                    </small>
                    <p>{approval.prompt}</p>
                    <small>created {formatTimestamp(approval.createdAt)}</small>
                  </div>
                  <div className="bridge-approval-actions">
                    <Button
                      type="button"
                      icon={<Check size={14} />}
                      className="cc-action-btn"
                      onClick={() => void onResolveApproval(approval.approvalId, "approved")}
                      disabled={busy}
                    >
                      Approve
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="bridge-danger-group">
              <div className="bridge-panel-group-label is-danger">
                <span>危险操作</span>
                <small>拒绝 approval 会中断当前等待中的用户动作。</small>
              </div>
              <div className="bridge-danger-action-list">
                {approvals.map((approval) => (
                  <Button
                    key={`reject-${approval.approvalId}`}
                    type="button"
                    variant="ghost"
                    icon={<X size={14} />}
                    className="cc-action-btn"
                    onClick={() => void onResolveApproval(approval.approvalId, "rejected")}
                    disabled={busy}
                  >
                    Reject {approval.approvalId}
                  </Button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <p className="hint">当前没有 pending approvals。</p>
        )}
      </div>

      <div className="bridge-panel-section">
        <div className="bridge-panel-header">
          <div>
            <h4>Logs & Secrets</h4>
            <p>查看 `bridge.log` 尾部内容与当前 token 掩码状态。</p>
          </div>
          <div className="cc-actions">
            <Button
              type="button"
              icon={<RefreshCw size={15} />}
              className="cc-action-btn"
              onClick={() => void onRefreshLogTail()}
              disabled={busy}
            >
              刷新日志
            </Button>
            <Button
              type="button"
              variant="ghost"
              icon={<RefreshCcw size={15} />}
              className="cc-action-btn"
              onClick={() => void onRefreshSecretsMask()}
              disabled={busy}
            >
              刷新掩码
            </Button>
          </div>
        </div>
        <div className="bridge-panel-subsection">
          <div className="bridge-panel-subheader">
            <h5>Bridge Log Tail</h5>
          </div>
          <pre className="log-tail bridge-log-tail">
            {logTail.length > 0 ? logTail.join("\n") : "暂无 bridge.log 内容。"}
          </pre>
        </div>
        <div className="bridge-panel-subsection">
          <div className="bridge-panel-subheader">
            <h5>Secrets Mask View</h5>
          </div>
          <div className="bridge-secret-list">
            {renderSecretRow("Telegram botToken", secretsMask.telegram.botToken)}
            {renderSecretRow("Feishu appId", secretsMask.feishu.appId)}
            {renderSecretRow("Feishu appSecret", secretsMask.feishu.appSecret)}
            {renderSecretRow(
              "Feishu verificationToken",
              secretsMask.feishu.verificationToken,
            )}
            {renderSecretRow("Feishu encryptKey", secretsMask.feishu.encryptKey)}
          </div>
        </div>
      </div>
    </div>
  );
}
