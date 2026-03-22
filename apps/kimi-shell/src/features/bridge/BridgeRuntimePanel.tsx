import { useState, type ReactNode } from "react";
import {
  Check,
  Download,
  FolderOpen,
  Plus,
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
  BridgeSessionImportInput,
  BridgeSessionRecord,
  BridgeSettings,
  BridgeStatus,
  FeishuReplyRenderer,
  WorkDirPreset,
} from "@/app/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ControlCenterCardHeader } from "@/features/control-center/ControlCenterCardHeader";

type BridgeRuntimePanelProps = {
  settings: BridgeSettings;
  effectiveDefaultWorkDir: string;
  status: BridgeStatus;
  sessions: BridgeSessionRecord[];
  bindings: BindingRecord[];
  approvals: BridgeApprovalRecord[];
  logTail: string[];
  recentErrors: string[];
  secretsMask: BridgeSecretsMaskView;
  busy: boolean;
  onSettingsChange: (next: BridgeSettings) => void;
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
  onResetBindingSession: (bindingId: string) => Promise<void>;
  onResetBindingToDefaultWorkDir: (bindingId: string) => Promise<void>;
  onResolveApproval: (
    approvalId: string,
    status: BridgeApprovalResolveInput["status"],
  ) => Promise<void>;
};

type BridgePanelSectionId =
  | "runtime"
  | "status"
  | "sessions"
  | "bindings"
  | "approvals"
  | "logs";

type SectionTone = "neutral" | "success" | "warning" | "danger";

function updateChannelEnabled(
  settings: BridgeSettings,
  platform: BridgePlatform,
  enabled: boolean,
): BridgeSettings {
  return {
    ...settings,
    channels: settings.channels.map((channel) =>
      channel.platform === platform ? { ...channel, enabled } : channel,
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
      presetIndex === index ? { ...preset, ...patch } : preset,
    ),
  };
}

function addWorkDirPreset(settings: BridgeSettings): BridgeSettings {
  return {
    ...settings,
    workDirPresets: [...settings.workDirPresets, { name: "", path: "" }],
  };
}

function removeWorkDirPreset(settings: BridgeSettings, index: number): BridgeSettings {
  return {
    ...settings,
    workDirPresets: settings.workDirPresets.filter((_, presetIndex) => presetIndex !== index),
  };
}

function platformLabel(platform: BridgePlatform): string {
  return platform === "telegram" ? "Telegram" : "飞书";
}

function feishuReplyRendererLabel(renderer: FeishuReplyRenderer): string {
  return renderer === "interactive" ? "交互卡片" : "帖子回退";
}

function sourceLabel(source: BridgeSessionRecord["source"]): string {
  return source === "bridge" ? "Bridge" : "Shell/Web 会话";
}

function formatTimestamp(value?: string): string {
  if (!value) return "-";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Date(timestamp).toLocaleString("zh-CN", {
    hour12: false,
    timeZoneName: "short",
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
        {value.configured ? "已配置" : "未配置"}
      </span>
    </div>
  );
}

function formatErrorLine(errorCode?: string, message?: string): string {
  const parts: string[] = [];
  if (errorCode) parts.push(`[${errorCode}]`);
  if (message) parts.push(message);
  return parts.join(" ").trim();
}

function formatSessionSummary(session: BridgeSessionRecord): string {
  const parts = [
    session.sessionState ? `状态 ${session.sessionState}` : null,
    session.workDir ? `目录 ${session.workDir}` : null,
    session.lastMessageAt ? `更新于 ${formatTimestamp(session.lastMessageAt)}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" | ") : "暂无附加信息。";
}

function formatRuntimeStateLabel(state: BridgeStatus["state"]): string {
  switch (state) {
    case "running":
      return "就绪";
    case "starting":
    case "stopping":
      return "进行中";
    case "degraded":
    case "crashed":
      return "异常";
    default:
      return "待办";
  }
}

function formatRuntimeStateTone(state: BridgeStatus["state"]): SectionTone {
  switch (state) {
    case "running":
      return "success";
    case "starting":
    case "stopping":
      return "warning";
    case "degraded":
    case "crashed":
      return "danger";
    default:
      return "neutral";
  }
}

function isChannelAutoRecovering(channel?: BridgeStatus["channels"][number]): boolean {
  return Boolean(
    channel &&
      channel.state !== "ready" &&
      channel.lastFailureRetryable &&
      channel.nextRetryAt,
  );
}

function formatRelativeTime(value?: string): string {
  if (!value) return "未记录";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  const diffMs = Math.abs(Date.now() - timestamp);
  const seconds = Math.max(1, Math.round(diffMs / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  const days = Math.round(hours / 24);
  return `${days} 天`;
}

function formatRetrySchedule(nextRetryAt?: string): string {
  if (!nextRetryAt) return "未安排自动重试";
  const timestamp = Date.parse(nextRetryAt);
  if (Number.isNaN(timestamp)) return nextRetryAt;
  const diffMs = timestamp - Date.now();
  if (diffMs <= 0) return `${formatTimestamp(nextRetryAt)}（应已到达）`;
  return `${formatTimestamp(nextRetryAt)}（约 ${formatRelativeTime(new Date(Date.now() + diffMs).toISOString())} 后）`;
}

function formatRecoveryHint(hint?: string): string {
  switch (hint) {
    case "host_connection_aborted":
      return "本机连接被中断，优先检查网络、代理、VPN、防火墙或杀软。";
    case "tls_timeout":
      return "TLS 握手超时，优先检查网络质量和代理链路。";
    case "connection_reset":
      return "连接被重置，通常是上游网络或中间链路抖动。";
    case "invalid_credentials":
      return "凭证无效，请检查 appId/appSecret。";
    case "permission_denied":
      return "权限或事件订阅不足，请检查飞书后台配置。";
    default:
      return hint?.trim() ? hint : "暂无恢复提示。";
  }
}

function formatFailureOperation(operation?: string): string {
  switch (operation) {
    case "credential_probe":
      return "credential_probe（凭证探活）";
    case "long_connection":
      return "long_connection（长连接）";
    default:
      return operation?.trim() ? operation : "未记录";
  }
}

function formatFeishuDiagnosis(channel?: BridgeStatus["channels"][number]): string {
  if (!channel) return "当前没有 Feishu 实时诊断数据。";
  if (isChannelAutoRecovering(channel)) {
    return "飞书通道正在自动恢复，建议先等待下一次自动重试。";
  }
  if (channel.recoveryHint === "host_connection_aborted") {
    return "最近一次断连更像是宿主机网络或安全软件中断了长连接。";
  }
  if (channel.state !== "ready") {
    return "飞书通道异常，但这不等于 binding 或 Session 已损坏。";
  }
  return "飞书通道已 ready；若仍感觉没有回复，优先检查 binding、Session、workdir 和 approvals。";
}

function normalizeComparablePath(path?: string): string {
  return (path ?? "")
    .trim()
    .replace(/\//g, "\\")
    .replace(/[\\]+$/, "")
    .toLowerCase();
}

export function BridgeRuntimePanel({
  settings,
  effectiveDefaultWorkDir,
  status,
  sessions,
  bindings,
  approvals,
  logTail,
  recentErrors,
  secretsMask,
  busy,
  onSettingsChange,
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
  onResetBindingSession,
  onResetBindingToDefaultWorkDir,
  onResolveApproval,
}: BridgeRuntimePanelProps) {
  const [expandedSections, setExpandedSections] = useState<Record<BridgePanelSectionId, boolean>>({
    runtime: false,
    status: true,
    sessions: false,
    bindings: false,
    approvals: false,
    logs: false,
  });
  const isRunning =
    status.state === "running" ||
    status.state === "starting" ||
    status.state === "degraded";
  const feishuChannel = status.channels.find((channel) => channel.platform === "feishu");
  const feishuAutoRecovering = isChannelAutoRecovering(feishuChannel);

  function toggleSection(sectionId: BridgePanelSectionId) {
    setExpandedSections((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
    }));
  }

  function renderSection(
    sectionId: BridgePanelSectionId,
    title: string,
    description: string,
    statusLabel: string,
    statusTone: SectionTone,
    children: ReactNode,
  ) {
    const expanded = expandedSections[sectionId];
    return (
      <section className={`bridge-panel-section ${expanded ? "is-expanded" : ""}`}>
        <ControlCenterCardHeader
          title={title}
          description={description}
          statusLabel={statusLabel}
          statusTone={statusTone}
          collapsible
          expanded={expanded}
          onToggle={() => toggleSection(sectionId)}
        />
        {expanded ? <div className="bridge-panel-section-body">{children}</div> : null}
      </section>
    );
  }

  return (
    <div className="bridge-panel">
      {renderSection(
        "status",
        "运行状态",
        "先看当前是否可用、最近错误和飞书恢复状态，再决定下一步动作。",
        formatRuntimeStateLabel(status.state),
        formatRuntimeStateTone(status.state),
        <>
          <div className="cc-actions">
            <Button type="button" icon={<RefreshCw size={15} />} className="cc-action-btn" onClick={() => void onRefreshStatus()} disabled={busy}>刷新状态</Button>
            <Button type="button" variant="ghost" icon={<RefreshCcw size={15} />} className="cc-action-btn" onClick={() => void Promise.all([onRefreshStatus(), onRefreshLogTail()])} disabled={busy}>刷新诊断</Button>
          </div>
          <div className="diagnostics-grid">
            <div className="diag-item"><span className="diag-label">PID</span><strong>{status.pid ?? "-"}</strong></div>
            <div className="diag-item"><span className="diag-label">版本</span><strong>{status.version ?? "-"}</strong></div>
            <div className="diag-item"><span className="diag-label">管理端口</span><strong>{status.adminPort}</strong></div>
            <div className="diag-item"><span className="diag-label">绑定数量</span><strong>{status.bindings}</strong></div>
            <div className="diag-item"><span className="diag-label">待处理审批</span><strong>{status.pendingApprovals}</strong></div>
            <div className="diag-item"><span className="diag-label">启动时间</span><strong>{formatTimestamp(status.startedAt)}</strong></div>
          </div>
          {status.lastError || status.lastErrorCode ? <p className="bridge-error-text">{formatErrorLine(status.lastErrorCode, status.lastError)}</p> : null}
          <div className="bridge-channel-statuses">
            {status.channels.length > 0 ? (
              status.channels.map((channel) => (
                <div key={channel.platform} className="bridge-channel-status-card">
                  <strong>{platformLabel(channel.platform)}</strong>
                  <span>
                    {channel.platform === "feishu" && channel.recoveryHint === "host_connection_aborted"
                      ? "本机连接被中断"
                      : channel.state}
                  </span>
                  <small>
                    偏移量: {channel.lastOffset ?? "-"}
                    {channel.lastError || channel.lastErrorCode ? ` | 错误: ${formatErrorLine(channel.lastErrorCode, channel.lastError)}` : ""}
                  </small>
                </div>
              ))
            ) : (
              <p className="hint">Bridge 未运行时不会返回实时通道状态。</p>
            )}
          </div>
          <div className="bridge-panel-subsection">
              <div className="bridge-panel-subheader">
                <h5>飞书连接恢复状态</h5>
              </div>
            {feishuChannel ? (
              <>
                <div className="diagnostics-grid">
                  <div className="diag-item"><span className="diag-label">当前状态</span><strong>{feishuChannel.recoveryHint === "host_connection_aborted" ? "本机连接被中断" : feishuChannel.state}</strong></div>
                  <div className="diag-item"><span className="diag-label">自动恢复中</span><strong>{feishuAutoRecovering ? "是" : "否"}</strong></div>
                  <div className="diag-item"><span className="diag-label">最近 ready</span><strong>{feishuChannel.lastReadyAt ? `${formatTimestamp(feishuChannel.lastReadyAt)} / ${formatRelativeTime(feishuChannel.lastReadyAt)} 前` : "-"}</strong></div>
                  <div className="diag-item"><span className="diag-label">最近失败</span><strong>{feishuChannel.lastFailureAt ? `${formatTimestamp(feishuChannel.lastFailureAt)} / ${formatRelativeTime(feishuChannel.lastFailureAt)} 前` : "-"}</strong></div>
                  <div className="diag-item"><span className="diag-label">连续失败</span><strong>{feishuChannel.consecutiveFailures ?? 0}</strong></div>
                  <div className="diag-item"><span className="diag-label">下一次重试</span><strong>{formatRetrySchedule(feishuChannel.nextRetryAt)}</strong></div>
                </div>
                <div className="bridge-error-list">
                  <div className="bridge-error-card">{formatFeishuDiagnosis(feishuChannel)}</div>
                  <div className="bridge-error-card">失败阶段：{formatFailureOperation(feishuChannel.lastFailureOperation)}</div>
                  <div className="bridge-error-card">恢复提示：{formatRecoveryHint(feishuChannel.recoveryHint)}</div>
                  {feishuChannel.lastError || feishuChannel.lastErrorCode ? (
                    <div className="bridge-error-card">最近错误：{formatErrorLine(feishuChannel.lastErrorCode, feishuChannel.lastError)}</div>
                  ) : null}
                  {feishuChannel.lastRecoveryAt ? (
                    <div className="bridge-error-card">最近恢复：{formatTimestamp(feishuChannel.lastRecoveryAt)}</div>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="hint">当前没有 Feishu 通道状态；bridge 未运行或 Feishu 未启用时不会展示恢复诊断。</p>
            )}
          </div>
          <div className="bridge-panel-subsection">
            <div className="bridge-panel-subheader">
              <h5>最近错误摘要</h5>
            </div>
            {recentErrors.length > 0 ? (
              <div className="bridge-error-list">
                {recentErrors.map((entry) => (
                  <div key={entry} className="bridge-error-card">{entry}</div>
                ))}
              </div>
            ) : (
              <p className="hint">最近没有采集到 bridge 错误摘要。</p>
            )}
          </div>
        </>,
      )}

      {renderSection(
        "sessions",
        "会话",
        "聚合显示 bridge-native Session 和 shell/web Session。",
        `${sessions.length} 个会话`,
        sessions.length > 0 ? "success" : "neutral",
        <>
          <div className="cc-actions">
            <Button type="button" variant="ghost" icon={<RefreshCcw size={15} />} className="cc-action-btn" onClick={() => void onRefreshSessions()} disabled={busy}>刷新会话</Button>
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
                            summary: `从 shell/web 会话 ${session.sessionId} 导入`,
                          })
                        }
                        disabled={busy}
                      >
                        导入为 Bridge 会话
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="hint">当前没有可展示的会话。bridge-native Session 需要 Bridge 运行；shell/web Session 需要后端工作区可访问。</p>
          )}
        </>,
      )}

      {renderSection(
        "bindings",
        "绑定",
        "查看当前聊天绑定的 Session 和工作目录映射。",
        `${bindings.length} 个绑定`,
        bindings.length > 0 ? "success" : "neutral",
        <>
          <div className="cc-actions">
            <Button type="button" variant="ghost" icon={<RefreshCcw size={15} />} className="cc-action-btn" onClick={() => void onRefreshBindings()} disabled={busy}>刷新绑定</Button>
          </div>
          {bindings.length > 0 ? (
            <>
              <div className="bridge-binding-list">
                {bindings.map((binding) => (
                  <div key={binding.bindingId} className="bridge-binding-card">
                    {(() => {
                      const followsDefaultWorkDir =
                        !!effectiveDefaultWorkDir &&
                        normalizeComparablePath(binding.workDir) ===
                          normalizeComparablePath(effectiveDefaultWorkDir);
                      const needsDefaultReset =
                        !!effectiveDefaultWorkDir && !followsDefaultWorkDir;
                      return (
                        <>
                    <div className="bridge-binding-copy">
                      <strong>{binding.bindingId}</strong>
                        <span>
                          {platformLabel(binding.platform)} / {binding.chatId}
                          {binding.threadId ? ` / ${binding.threadId}` : ""}
                        </span>
                        <small>
                          Session {binding.kimiSessionId}
                          {binding.workDir ? ` | 工作目录 ${binding.workDir}` : ""}
                          {binding.lastInboundMessageId ? ` | 最近入站 ${binding.lastInboundMessageId}` : ""}
                        </small>
                      {needsDefaultReset ? (
                        <p>当前 binding 未跟随 IM 默认目录：{effectiveDefaultWorkDir}</p>
                      ) : followsDefaultWorkDir ? (
                        <p>当前 binding 已跟随 IM 默认目录。</p>
                      ) : null}
                    </div>
                    <div className="bridge-approval-actions">
                      <Button
                        type="button"
                        icon={<Check size={14} />}
                        className="cc-action-btn"
                        onClick={() => void onResetBindingToDefaultWorkDir(binding.bindingId)}
                        disabled={busy || !effectiveDefaultWorkDir}
                      >
                        回到 IM 默认目录
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        icon={<Plus size={14} />}
                        className="cc-action-btn"
                        onClick={() => void onResetBindingSession(binding.bindingId)}
                        disabled={busy}
                      >
                        新建并切换 Session
                      </Button>
                    </div>
                        </>
                      );
                    })()}
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
                    <Button key={`clear-${binding.bindingId}`} type="button" variant="ghost" icon={<Trash2 size={14} />} className="cc-action-btn" onClick={() => void onClearBinding(binding.bindingId)} disabled={busy}>
                      清理 {binding.bindingId}
                    </Button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <p className="hint">当前没有绑定。Bridge 停止时列表会显示为空。</p>
          )}
        </>,
      )}

      {renderSection(
        "approvals",
        "待处理审批",
        "支持单次批准、当前 Session 批准和拒绝。",
        `${approvals.length} 个审批`,
        approvals.length > 0 ? "warning" : "neutral",
        <>
          <div className="cc-actions">
            <Button type="button" variant="ghost" icon={<RefreshCcw size={15} />} className="cc-action-btn" onClick={() => void onRefreshApprovals()} disabled={busy}>刷新审批</Button>
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
                    <small>创建于 {formatTimestamp(approval.createdAt)}</small>
                  </div>
                  <div className="bridge-approval-actions">
                    <Button type="button" icon={<Check size={14} />} className="cc-action-btn" onClick={() => void onResolveApproval(approval.approvalId, "approved")} disabled={busy}>批准一次</Button>
                    <Button type="button" variant="outline" icon={<RefreshCw size={14} />} className="cc-action-btn" onClick={() => void onResolveApproval(approval.approvalId, "approved_for_session")} disabled={busy}>批准当前 Session</Button>
                    <Button type="button" variant="ghost" icon={<X size={14} />} className="cc-action-btn" onClick={() => void onResolveApproval(approval.approvalId, "rejected")} disabled={busy}>拒绝</Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="hint">当前没有待处理审批。</p>
          )}
        </>,
      )}

      {renderSection(
        "logs",
        "日志与密钥",
        "查看 `bridge.log` 尾部内容和当前密钥掩码状态。",
        `${logTail.length} 行日志`,
        logTail.length > 0 ? "success" : "neutral",
        <>
          <div className="cc-actions">
            <Button type="button" icon={<RefreshCw size={15} />} className="cc-action-btn" onClick={() => void onRefreshLogTail()} disabled={busy}>刷新日志</Button>
            <Button type="button" variant="ghost" icon={<RefreshCcw size={15} />} className="cc-action-btn" onClick={() => void onRefreshSecretsMask()} disabled={busy}>刷新掩码</Button>
          </div>
            <div className="bridge-panel-subsection">
              <div className="bridge-panel-subheader">
                <h5>Bridge 日志尾部</h5>
              </div>
              <pre className="log-tail bridge-log-tail">{logTail.length > 0 ? logTail.join("\n") : "暂无 bridge.log 内容。"}</pre>
            </div>
            <div className="bridge-panel-subsection">
              <div className="bridge-panel-subheader">
                <h5>密钥掩码视图</h5>
              </div>
              <div className="bridge-secret-list">
                {renderSecretRow("Telegram botToken", secretsMask.telegram.botToken)}
                {renderSecretRow("飞书 appId", secretsMask.feishu.appId)}
                {renderSecretRow("飞书 appSecret", secretsMask.feishu.appSecret)}
                {renderSecretRow("飞书 verificationToken", secretsMask.feishu.verificationToken)}
                {renderSecretRow("飞书 encryptKey", secretsMask.feishu.encryptKey)}
              </div>
            </div>
        </>,
      )}

      {renderSection(
        "runtime",
        "高级设置",
        "维护专家级配置；改完后请回到上方主按钮统一应用。",
        formatRuntimeStateLabel(status.state),
        formatRuntimeStateTone(status.state),
        <>
          <div className="cc-actions">
            <Button type="button" icon={<RefreshCw size={15} />} className="cc-action-btn" onClick={() => void onRefreshStatus()} disabled={busy}>刷新状态</Button>
            <Button type="button" variant="ghost" icon={<RefreshCcw size={15} />} className="cc-action-btn" onClick={() => void onRefreshSessions()} disabled={busy}>刷新会话</Button>
            <Button type="button" variant="ghost" icon={<FolderOpen size={15} />} className="cc-action-btn" onClick={() => void onOpenLogs()}>打开日志目录</Button>
          </div>

          <div className="bridge-panel-group">
            <div className="bridge-panel-group-label">
              <span>常规配置</span>
              <small>修改后会写入 `bridge_settings.json`；运行中的 Bridge 需要应用并重启后生效。</small>
            </div>

            <div className="bridge-settings-grid">
              <label className="bridge-switch-card">
                <span className="bridge-switch-copy">
                  <strong>启用 Bridge</strong>
                  <small>控制 sidecar 总开关。</small>
                </span>
                <input
                  type="checkbox"
                  className="cc-switch-input"
                  checked={settings.enabled}
                  onChange={(event) =>
                    onSettingsChange({
                      ...settings,
                      enabled: event.currentTarget.checked,
                    })
                  }
                />
                <span className="cc-switch-track" aria-hidden />
              </label>

              <label className="bridge-port-card">
                <span>管理端口</span>
                <Input value={String(settings.adminPort)} onChange={(event) => onSettingsChange({ ...settings, adminPort: Number(event.currentTarget.value) || 60110 })} inputMode="numeric" />
                <small>用于 Bridge 管理接口联调，普通场景通常不需要改动。</small>
              </label>

              <label className="bridge-port-card">
                <span>飞书回复渲染方式</span>
                <select className="ui-input" value={settings.feishuReplyRenderer} onChange={(event) => onSettingsChange({ ...settings, feishuReplyRenderer: event.currentTarget.value as FeishuReplyRenderer })}>
                  <option value="interactive">{feishuReplyRendererLabel("interactive")}</option>
                  <option value="post">{feishuReplyRendererLabel("post")}</option>
                </select>
                <small>普通模型回复默认建议使用 `interactive + lark_md`；`post` 仅作为兼容回退。</small>
              </label>

              <label className="bridge-switch-card">
                <span className="bridge-switch-copy">
                  <strong>飞书自动审批</strong>
                  <small>开启后，飞书对话会自动批准工具执行审批（WithAutoApprove）。</small>
                </span>
                <input
                  type="checkbox"
                  className="cc-switch-input"
                  checked={settings.feishuAutoApprove}
                  onChange={(event) =>
                    onSettingsChange({
                      ...settings,
                      feishuAutoApprove: event.currentTarget.checked,
                    })
                  }
                />
                <span className="cc-switch-track" aria-hidden />
              </label>

              <label className="bridge-switch-card">
                <span className="bridge-switch-copy">
                  <strong>每次 Bridge 启动新建 Session</strong>
                  <small>开启后，Bridge 每次启动成功都会为现有 binding 生成并切换到新的 Session。</small>
                </span>
                <input
                  type="checkbox"
                  className="cc-switch-input"
                  checked={settings.resetBindingSessionOnBridgeStart}
                  onChange={(event) =>
                    onSettingsChange({
                      ...settings,
                      resetBindingSessionOnBridgeStart: event.currentTarget.checked,
                    })
                  }
                />
                <span className="cc-switch-track" aria-hidden />
              </label>
            </div>

            <div className="bridge-channel-list">
              {settings.channels.map((channel) => (
                <label
                  key={channel.platform}
                  className="bridge-channel-card bridge-switch-card"
                >
                  <div className="bridge-channel-copy">
                    <strong>{platformLabel(channel.platform)}</strong>
                    <small>连接模式: {channel.mode}</small>
                  </div>
                  <input
                    type="checkbox"
                    className="cc-switch-input"
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
                  <span className="cc-switch-track" aria-hidden />
                </label>
              ))}
            </div>

            <div className="bridge-panel-subsection">
              <div className="bridge-panel-subheader">
                <h5>工作目录预设</h5>
              </div>
              <p className="hint">飞书 `/bridge cwd` 卡片会直接展示这些预设目录按钮。保存时会自动过滤空项，并按路径去重。</p>
              {settings.workDirPresets.length > 0 ? (
                <div className="bridge-preset-list">
                  {settings.workDirPresets.map((preset, index) => (
                    <div key={`preset-${index}`} className="bridge-preset-row">
                      <div className="bridge-preset-fields">
                        <label className="bridge-preset-field">
                          <span>名称</span>
                          <Input value={preset.name} onChange={(event) => onSettingsChange(updateWorkDirPreset(settings, index, { name: event.currentTarget.value }))} placeholder="例如 Repo" />
                        </label>
                        <label className="bridge-preset-field">
                          <span>路径</span>
                          <Input value={preset.path} onChange={(event) => onSettingsChange(updateWorkDirPreset(settings, index, { path: event.currentTarget.value }))} placeholder="例如 D:/workspace/repo" />
                        </label>
                      </div>
                      <Button type="button" variant="ghost" icon={<Trash2 size={14} />} className="cc-action-btn" onClick={() => onSettingsChange(removeWorkDirPreset(settings, index))} disabled={busy}>删除</Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="hint">还没有工作目录预设。你可以添加常用目录，供飞书 `/bridge cwd` 直接点选。</p>
              )}
              <div className="bridge-action-row">
                <Button type="button" variant="outline" icon={<Plus size={14} />} className="cc-action-btn" onClick={() => onSettingsChange(addWorkDirPreset(settings))} disabled={busy}>新增预设</Button>
              </div>
              {isRunning ? <p className="hint">如果 Bridge 正在运行，保存后需要重启 Bridge，飞书 `/bridge cwd` 卡片才会加载最新预设。</p> : null}
            </div>

            <p className="hint">当前区域只编辑高级设置；请使用上方主按钮统一保存、启动或应用并重启。</p>
          </div>

          <div className="bridge-danger-group">
            <div className="bridge-panel-group-label is-danger">
              <span>危险操作</span>
              <small>会中断运行中的 Bridge 或触发重连。</small>
            </div>
            <div className="bridge-action-row">
              <Button type="button" variant="destructive" icon={<Square size={15} />} className="cc-action-btn" onClick={() => void onStop()} disabled={busy || !isRunning}>停止 Bridge</Button>
              <Button type="button" variant="outline" icon={<RefreshCcw size={15} />} className="cc-action-btn" onClick={() => void onRestart()} disabled={busy}>重启 Bridge</Button>
            </div>
          </div>
        </>,
      )}
    </div>
  );
}
