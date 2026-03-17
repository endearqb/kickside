import {
  Check,
  Download,
  FolderOpen,
  Plus,
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
  FeishuReplyRenderer,
  BridgeSecretsMaskView,
  BridgeSessionImportInput,
  BridgeSessionRecord,
  BridgeSettings,
  BridgeStatus,
  WorkDirPreset,
} from "@/app/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type BridgeRuntimePanelProps = {
  settings: BridgeSettings;
  status: BridgeStatus;
  sessions: BridgeSessionRecord[];
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
  onRefreshSessions: () => Promise<BridgeSessionRecord[]>;
  onRefreshBindings: () => Promise<BindingRecord[]>;
  onRefreshApprovals: () => Promise<BridgeApprovalRecord[]>;
  onRefreshLogTail: () => Promise<string[]>;
  onRefreshSecretsMask: () => Promise<BridgeSecretsMaskView>;
  onOpenLogs: () => Promise<void>;
  onImportSession: (input: BridgeSessionImportInput) => Promise<void>;
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

function updateWorkDirPreset(
  settings: BridgeSettings,
  index: number,
  patch: Partial<WorkDirPreset>,
): BridgeSettings {
  return {
    ...settings,
    workDirPresets: settings.workDirPresets.map((preset, presetIndex) =>
      presetIndex === index
        ? {
            ...preset,
            ...patch,
          }
        : preset,
    ),
  };
}

function addWorkDirPreset(settings: BridgeSettings): BridgeSettings {
  return {
    ...settings,
    workDirPresets: [
      ...settings.workDirPresets,
      {
        name: "",
        path: "",
      },
    ],
  };
}

function removeWorkDirPreset(settings: BridgeSettings, index: number): BridgeSettings {
  return {
    ...settings,
    workDirPresets: settings.workDirPresets.filter((_, presetIndex) => presetIndex !== index),
  };
}

function platformLabel(platform: BridgePlatform): string {
  return platform === "telegram" ? "Telegram" : "Feishu";
}

function feishuReplyRendererLabel(renderer: FeishuReplyRenderer): string {
  return renderer === "interactive" ? "Interactive card" : "Post fallback";
}

function sourceLabel(source: BridgeSessionRecord["source"]): string {
  return source === "bridge" ? "Bridge" : "Shell/Web";
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

function formatSessionSummary(session: BridgeSessionRecord): string {
  const parts = [
    session.sessionState ? `state ${session.sessionState}` : null,
    session.workDir ? `dir ${session.workDir}` : null,
    session.lastMessageAt ? `updated ${formatTimestamp(session.lastMessageAt)}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" | ") : "暂无附加信息。";
}

export function BridgeRuntimePanel({
  settings,
  status,
  sessions,
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
  onRefreshSessions,
  onRefreshBindings,
  onRefreshApprovals,
  onRefreshLogTail,
  onRefreshSecretsMask,
  onOpenLogs,
  onImportSession,
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
            <p>管理 sidecar 进程、端口、默认工作目录和渠道状态。</p>
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
              onClick={() => void onRefreshSessions()}
              disabled={busy}
            >
              刷新 sessions
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
            <small>保存后会同步到 `bridge_settings.json`。</small>
          </div>

          <div className="bridge-settings-grid">
            <label className="bridge-switch-card">
              <span className="bridge-switch-copy">
                <strong>Enable bridge</strong>
                <small>控制 sidecar 总开关。</small>
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

            <label className="bridge-port-card">
              <span>Default Work Dir</span>
              <Input
                value={settings.defaultWorkDir ?? ""}
                onChange={(event) =>
                  onSettingsChange({
                    ...settings,
                    defaultWorkDir: event.currentTarget.value,
                  })
                }
                placeholder="留空时跟随应用工作目录，例如 D:/workspace"
              />
              <small>留空时，IM Bridge 会跟随应用设置里的默认工作目录。</small>
            </label>

            <label className="bridge-port-card">
              <span>Feishu Reply Renderer</span>
              <select
                className="ui-input"
                value={settings.feishuReplyRenderer}
                onChange={(event) =>
                  onSettingsChange({
                    ...settings,
                    feishuReplyRenderer: event.currentTarget
                      .value as FeishuReplyRenderer,
                  })
                }
              >
                <option value="interactive">
                  {feishuReplyRendererLabel("interactive")}
                </option>
                <option value="post">{feishuReplyRendererLabel("post")}</option>
              </select>
              <small>普通模型回复默认建议使用 `interactive + lark_md`；`post` 仅作为兼容回退。</small>
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

          <div className="bridge-panel-subsection">
            <div className="bridge-panel-subheader">
              <h5>Work Dir Presets</h5>
            </div>
            <p className="hint">
              飞书 `/bridge cwd` 卡片会直接展示这些预设目录按钮。保存时会自动过滤空项，并按路径去重。
            </p>
            {settings.workDirPresets.length > 0 ? (
              <div className="bridge-preset-list">
                {settings.workDirPresets.map((preset, index) => (
                  <div key={`preset-${index}`} className="bridge-preset-row">
                    <div className="bridge-preset-fields">
                      <label className="bridge-preset-field">
                        <span>Name</span>
                        <Input
                          value={preset.name}
                          onChange={(event) =>
                            onSettingsChange(
                              updateWorkDirPreset(settings, index, {
                                name: event.currentTarget.value,
                              }),
                            )
                          }
                          placeholder="例如 Repo"
                        />
                      </label>
                      <label className="bridge-preset-field">
                        <span>Path</span>
                        <Input
                          value={preset.path}
                          onChange={(event) =>
                            onSettingsChange(
                              updateWorkDirPreset(settings, index, {
                                path: event.currentTarget.value,
                              }),
                            )
                          }
                          placeholder="例如 D:/workspace/repo"
                        />
                      </label>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      icon={<Trash2 size={14} />}
                      className="cc-action-btn"
                      onClick={() => onSettingsChange(removeWorkDirPreset(settings, index))}
                      disabled={busy}
                    >
                      删除
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="hint">还没有工作目录预设。你可以添加常用目录，供飞书 `/bridge cwd` 直接点选。</p>
            )}
            <div className="bridge-action-row">
              <Button
                type="button"
                variant="outline"
                icon={<Plus size={14} />}
                className="cc-action-btn"
                onClick={() => onSettingsChange(addWorkDirPreset(settings))}
                disabled={busy}
              >
                Add preset
              </Button>
            </div>
            {isRunning ? (
              <p className="hint">
                如果 bridge 正在运行，保存后需要重启 bridge，飞书 `/bridge cwd` 卡片才会加载最新预设。
              </p>
            ) : null}
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
            <h4>Sessions</h4>
            <p>聚合显示 bridge-native session 与 shell/web session。</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            icon={<RefreshCcw size={15} />}
            className="cc-action-btn"
            onClick={() => void onRefreshSessions()}
            disabled={busy}
          >
            刷新 sessions
          </Button>
        </div>
        {sessions.length > 0 ? (
          <div className="bridge-binding-list">
            {sessions.map((session) => (
              <div key={`${session.source}:${session.sessionId}`} className="bridge-binding-card">
                <div className="bridge-binding-copy">
                  <strong>{session.sessionId}</strong>
                  <span>
                    {sourceLabel(session.source)}
                    {session.providerName ? ` / ${session.providerName}` : ""}
                  </span>
                  <small>{formatSessionSummary(session)}</small>
                  {session.summary ? <p>{session.summary}</p> : null}
                </div>
                {session.importable ? (
                  <div className="bridge-approval-actions">
                    <Button
                      type="button"
                      variant="outline"
                      icon={<Download size={14} />}
                      className="cc-action-btn"
                      onClick={() =>
                        void onImportSession({
                          source: session.source,
                          sourceSessionId: session.sessionId,
                          workDir: session.workDir,
                          summary: `Imported from shell/web session ${session.sessionId}`,
                        })
                      }
                      disabled={busy}
                    >
                      Import as bridge session
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="hint">
            当前没有可展示的 session。bridge-native session 需要 bridge 运行；shell/web session 需要后端 workspace 可访问。
          </p>
        )}
      </div>

      <div className="bridge-panel-section">
        <div className="bridge-panel-header">
          <div>
            <h4>Bindings</h4>
            <p>查看当前聊天绑定的 session / workdir 映射。</p>
          </div>
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
                      {binding.workDir ? ` | cwd ${binding.workDir}` : ""}
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
            <p>支持 approve once / approve for session / reject。</p>
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
                    Approve once
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    icon={<RefreshCw size={14} />}
                    className="cc-action-btn"
                    onClick={() =>
                      void onResolveApproval(approval.approvalId, "approved_for_session")
                    }
                    disabled={busy}
                  >
                    Approve for session
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    icon={<X size={14} />}
                    className="cc-action-btn"
                    onClick={() => void onResolveApproval(approval.approvalId, "rejected")}
                    disabled={busy}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
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
