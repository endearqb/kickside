import { useMemo } from "react";
import {
  Check,
  Download,
  FolderOpen,
  Plus,
  RefreshCcw,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import type {
  BindingRecord,
  BridgeApprovalRecord,
  BridgeApprovalResolveInput,
  BridgeConnectorConfig,
  BridgeConnectorSecretsMaskView,
  BridgePlatform,
  BridgeSessionImportInput,
  BridgeSessionRecord,
  BridgeStatus,
} from "@/app/types";
import { ControlCenterMetricCard } from "@/components/control-center/ControlCenterMetricCard";
import { ControlCenterStatusBadge } from "@/components/control-center/ControlCenterStatusBadge";
import { ControlCenterSurfaceSection } from "@/components/control-center/ControlCenterSurfaceSection";
import { Button } from "@/components/ui/button";

type Props = {
  connector: BridgeConnectorConfig;
  status: BridgeStatus;
  sessions: BridgeSessionRecord[];
  bindings: BindingRecord[];
  approvals: BridgeApprovalRecord[];
  logTail: string[];
  recentErrors: string[];
  secretsMask: BridgeConnectorSecretsMaskView | null;
  busy: boolean;
  onRefreshStatus: () => Promise<BridgeStatus>;
  onRefreshSessions: () => Promise<BridgeSessionRecord[]>;
  onRefreshBindings: () => Promise<BindingRecord[]>;
  onRefreshApprovals: () => Promise<BridgeApprovalRecord[]>;
  onRefreshLogTail: () => Promise<string[]>;
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

function formatTs(value?: string) {
  if (!value) {
    return "-";
  }
  return Number.isNaN(Date.parse(value))
    ? value
    : new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function formatPlatform(platform: BridgePlatform) {
  return platform === "telegram" ? "Telegram" : "飞书";
}

function formatConnectorState(state?: string) {
  switch (state) {
    case "ready":
      return "已就绪";
    case "connecting":
      return "连接中";
    case "degraded":
      return "降级";
    case "error":
      return "异常";
    case "idle":
    default:
      return "空闲";
  }
}

function matchConnectorLog(entry: string, connector: BridgeConnectorConfig) {
  const lower = entry.toLowerCase();
  return (
    lower.includes(connector.id.toLowerCase()) ||
    lower.includes(connector.label.toLowerCase()) ||
    lower.includes(connector.platform)
  );
}

function renderSecretRows(secretsMask: BridgeConnectorSecretsMaskView | null) {
  if (!secretsMask) {
    return <p className="hint">当前还没有这个机器人的凭据掩码信息。</p>;
  }

  if (secretsMask.platform === "telegram" && secretsMask.telegram) {
    return (
      <div className="bridge-secret-list">
        <div className="bridge-secret-row">
          <div className="bridge-secret-copy">
            <strong>Telegram botToken</strong>
            <small>
              {secretsMask.telegram.botToken.configured
                ? secretsMask.telegram.botToken.maskedValue ?? "***"
                : "未配置"}
            </small>
          </div>
          <span
            className={`bridge-secret-chip ${
              secretsMask.telegram.botToken.configured ? "configured" : "empty"
            }`}
          >
            {secretsMask.telegram.botToken.configured ? "已配置" : "未配置"}
          </span>
        </div>
      </div>
    );
  }

  if (secretsMask.platform === "feishu" && secretsMask.feishu) {
    const rows = [
      ["飞书 appId", secretsMask.feishu.appId],
      ["飞书 appSecret", secretsMask.feishu.appSecret],
      ["飞书 verificationToken", secretsMask.feishu.verificationToken],
      ["飞书 encryptKey", secretsMask.feishu.encryptKey],
    ] as const;
    return (
      <div className="bridge-secret-list">
        {rows.map(([label, value]) => (
          <div key={label} className="bridge-secret-row">
            <div className="bridge-secret-copy">
              <strong>{label}</strong>
              <small>{value.configured ? value.maskedValue ?? "***" : "未配置"}</small>
            </div>
            <span
              className={`bridge-secret-chip ${value.configured ? "configured" : "empty"}`}
            >
              {value.configured ? "已配置" : "未配置"}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return <p className="hint">当前没有可展示的凭据掩码。</p>;
}

export function BridgeRuntimePanel({
  connector,
  status,
  sessions,
  bindings,
  approvals,
  logTail,
  recentErrors,
  secretsMask,
  busy,
  onRefreshStatus,
  onRefreshSessions,
  onRefreshBindings,
  onRefreshApprovals,
  onRefreshLogTail,
  onOpenLogs,
  onImportSession,
  onClearBinding,
  onResetBindingSession,
  onResetBindingToDefaultWorkDir,
  onResolveApproval,
}: Props) {
  const connectorStatus = useMemo(
    () => status.connectors.find((item) => item.connectorId === connector.id) ?? null,
    [connector.id, status.connectors],
  );
  const connectorBindings = useMemo(
    () => bindings.filter((item) => item.connectorId === connector.id),
    [bindings, connector.id],
  );
  const connectorApprovals = useMemo(
    () => approvals.filter((item) => item.connectorId === connector.id),
    [approvals, connector.id],
  );
  const connectorSessionIds = useMemo(
    () => new Set(connectorBindings.map((item) => item.kimiSessionId)),
    [connectorBindings],
  );
  const connectorSessions = useMemo(
    () => sessions.filter((item) => connectorSessionIds.has(item.sessionId)),
    [connectorSessionIds, sessions],
  );
  const connectorRecentErrors = useMemo(() => {
    const filtered = recentErrors.filter((entry) => matchConnectorLog(entry, connector));
    if (filtered.length > 0) {
      return filtered;
    }
    const fallback = [connectorStatus?.lastErrorCode, connectorStatus?.lastError]
      .filter(Boolean)
      .join(" ");
    return fallback ? [fallback] : [];
  }, [connector, connectorStatus?.lastError, connectorStatus?.lastErrorCode, recentErrors]);
  const connectorLogs = useMemo(() => {
    const filtered = logTail.filter((entry) => matchConnectorLog(entry, connector));
    return filtered.length > 0 ? filtered : logTail.slice(-40);
  }, [connector, logTail]);

  return (
    <div className="bridge-panel">
      <ControlCenterSurfaceSection
        title="运行状态"
        actions={
          <div className="cc-actions">
            <Button
              type="button"
              icon={<RefreshCw size={15} />}
              className="cc-action-btn"
              onClick={() => void Promise.all([onRefreshStatus(), onRefreshLogTail()])}
              disabled={busy}
            >
              刷新诊断
            </Button>
          </div>
        }
        className="bridge-panel-section is-expanded"
      >
        <div className="diagnostics-grid">
          <ControlCenterMetricCard label="机器人" value={connector.label} />
          <ControlCenterMetricCard label="Connector ID" value={connector.id} />
          <ControlCenterMetricCard label="平台" value={formatPlatform(connector.platform)} />
          <ControlCenterMetricCard
            label="实时状态"
            value={formatConnectorState(connectorStatus?.state)}
          />
          <ControlCenterMetricCard
            label="最近就绪"
            value={formatTs(connectorStatus?.lastReadyAt)}
          />
          <ControlCenterMetricCard
            label="最近失败"
            value={formatTs(connectorStatus?.lastFailureAt)}
          />
        </div>
        {connectorRecentErrors.length > 0 ? (
          <div className="bridge-error-list">
            {connectorRecentErrors.map((entry) => (
              <div key={entry} className="bridge-error-card">
                {entry}
              </div>
            ))}
          </div>
        ) : null}
      </ControlCenterSurfaceSection>

      <ControlCenterSurfaceSection
        title="绑定与会话"
        actions={
          <div className="cc-actions">
            <Button
              type="button"
              variant="ghost"
              icon={<RefreshCcw size={15} />}
              className="cc-action-btn"
              onClick={() => void Promise.all([onRefreshBindings(), onRefreshSessions()])}
              disabled={busy}
            >
              刷新绑定
            </Button>
          </div>
        }
        className="bridge-panel-section is-expanded"
      >

        <div className="bridge-panel-subsection">
          <div className="bridge-panel-subheader">
            <h5>当前绑定</h5>
            <ControlCenterStatusBadge>{connectorBindings.length} 个</ControlCenterStatusBadge>
          </div>
          {connectorBindings.length > 0 ? (
            <div className="bridge-binding-list">
              {connectorBindings.map((binding) => (
                <div key={binding.bindingId} className="bridge-binding-card">
                  <div className="bridge-binding-copy">
                    <strong>{binding.connectorLabel || connector.label}</strong>
                    <span>
                      {binding.chatId}
                      {binding.threadId ? ` / ${binding.threadId}` : ""}
                    </span>
                    <small>
                      Session {binding.kimiSessionId}
                      {binding.workDir ? ` | ${binding.workDir}` : ""}
                    </small>
                  </div>
                  <div className="bridge-approval-actions">
                    <Button
                      type="button"
                      icon={<Plus size={14} />}
                      className="cc-action-btn"
                      onClick={() => void onResetBindingSession(binding.bindingId)}
                      disabled={busy}
                    >
                      新建对话
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      icon={<Check size={14} />}
                      className="cc-action-btn"
                      onClick={() => void onResetBindingToDefaultWorkDir(binding.bindingId)}
                      disabled={busy}
                    >
                      回到默认目录
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      icon={<Trash2 size={14} />}
                      className="cc-action-btn"
                      onClick={() => void onClearBinding(binding.bindingId)}
                      disabled={busy}
                    >
                      清理绑定
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="hint">当前机器人还没有建立聊天绑定。</p>
          )}
        </div>

        <div className="bridge-panel-subsection">
          <div className="bridge-panel-subheader">
            <h5>关联会话</h5>
            <ControlCenterStatusBadge>{connectorSessions.length} 个</ControlCenterStatusBadge>
          </div>
          {connectorSessions.length > 0 ? (
            <div className="bridge-binding-list">
              {connectorSessions.map((session) => (
                <div key={`${session.source}:${session.sessionId}`} className="bridge-binding-card">
                  <div className="bridge-binding-copy">
                    <strong>{session.sessionId}</strong>
                    <span>
                      {session.source === "bridge" ? "Bridge" : "Shell/Web"}
                      {session.providerName ? ` / ${session.providerName}` : ""}
                    </span>
                    <small>
                      {session.sessionState ?? "未记录"}
                      {session.workDir ? ` | ${session.workDir}` : ""}
                      {session.lastMessageAt ? ` | ${formatTs(session.lastMessageAt)}` : ""}
                    </small>
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
                            summary: `从 ${connector.label} 关联会话 ${session.sessionId} 导入`,
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
          <p className="hint">当前还没有可展示的关联会话。</p>
        )}
        </div>
      </ControlCenterSurfaceSection>

      <ControlCenterSurfaceSection
        title="待处理审批"
        description="审批列表已经按当前机器人过滤，不会混入其他 connector 的请求。"
        actions={
          <div className="cc-actions">
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
        }
        className="bridge-panel-section is-expanded"
      >
        {connectorApprovals.length > 0 ? (
          <div className="bridge-approval-list">
            {connectorApprovals.map((approval) => (
              <div key={approval.approvalId} className="bridge-approval-card">
                <div className="bridge-approval-copy">
                  <strong>{approval.connectorLabel || connector.label}</strong>
                  <span>
                    {approval.kimiSessionId} / {approval.requestKind}
                  </span>
                  <small>
                    {approval.chatId}
                    {approval.threadId ? ` / ${approval.threadId}` : ""}
                    {` | ${formatTs(approval.createdAt)}`}
                  </small>
                  <p>{approval.prompt}</p>
                </div>
                <div className="bridge-approval-actions">
                  <Button
                    type="button"
                    icon={<Check size={14} />}
                    className="cc-action-btn"
                    onClick={() => void onResolveApproval(approval.approvalId, "approved")}
                    disabled={busy}
                  >
                    批准一次
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
                    批准当前 Session
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    icon={<X size={14} />}
                    className="cc-action-btn"
                    onClick={() => void onResolveApproval(approval.approvalId, "rejected")}
                    disabled={busy}
                  >
                    拒绝
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="hint">当前没有待处理审批。</p>
        )}
      </ControlCenterSurfaceSection>

      <ControlCenterSurfaceSection
        title="凭据与日志"
        description="凭据只展示掩码，日志优先过滤到当前 connector，找不到时回退到全局尾部。"
        actions={
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
              icon={<FolderOpen size={15} />}
              className="cc-action-btn"
              onClick={() => void onOpenLogs()}
            >
              打开日志目录
            </Button>
          </div>
        }
        className="bridge-panel-section is-expanded"
      >
        <div className="bridge-panel-subsection">
          <div className="bridge-panel-subheader">
            <h5>凭据掩码</h5>
          </div>
          {renderSecretRows(secretsMask)}
        </div>
        <div className="bridge-panel-subsection">
          <div className="bridge-panel-subheader">
            <h5>相关日志</h5>
          </div>
          <pre className="log-tail bridge-log-tail">
            {connectorLogs.length > 0 ? connectorLogs.join("\n") : "暂无 bridge.log 内容。"}
          </pre>
        </div>
      </ControlCenterSurfaceSection>
    </div>
  );
}