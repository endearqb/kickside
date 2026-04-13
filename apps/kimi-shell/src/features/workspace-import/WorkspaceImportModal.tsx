import { FolderOpen, X } from "lucide-react";
import type {
  WorkspaceImportRequestPayload,
  WorkspaceImportResult,
  WorkspaceImportTarget,
} from "@/app/types";
import { Button } from "@/components/ui/button";

type WorkspaceImportPickerProps = {
  request: WorkspaceImportRequestPayload | null;
  targets: WorkspaceImportTarget[];
  busy: boolean;
  errorMessage?: string | null;
  onSelectTarget: (target: WorkspaceImportTarget) => Promise<unknown> | void;
  onBrowse: () => Promise<unknown> | void;
  onCancel: () => Promise<unknown> | void;
};

type WorkspaceImportResultNoticeProps = {
  result: WorkspaceImportResult | null;
  onDismiss: () => void;
};

function describeTarget(target: WorkspaceImportTarget) {
  if (target.isCurrent && target.isDefault) {
    return "当前 / 默认";
  }
  if (target.isCurrent) {
    return "当前";
  }
  if (target.isDefault) {
    return "默认";
  }
  return "已知";
}

function buildPreviewLabel(request: WorkspaceImportRequestPayload | null) {
  if (!request) {
    return "暂无待处理导入请求。";
  }

  const primaryPath = request.itemPaths[0]?.trim();
  if (!primaryPath) {
    return `${request.itemCount} 项待导入内容`;
  }

  if (request.itemCount <= 1) {
    return primaryPath;
  }

  return `${primaryPath} 等 ${request.itemCount} 项`;
}

function WorkspaceImportPickerContent({
  request,
  targets,
  busy,
  errorMessage,
  onSelectTarget,
  onBrowse,
  onCancel,
  variant,
}: WorkspaceImportPickerProps & { variant: "modal" | "window" }) {
  const previewLabel = buildPreviewLabel(request);

  return (
    <div
      className={`workspace-import-content ${
        variant === "window" ? "workspace-import-content-window" : "workspace-import-content-modal"
      }`}
      role="dialog"
      aria-modal={variant === "modal"}
      aria-label="选择目标工作区"
    >
      <header className="workspace-import-header">
        <div className="workspace-import-header-copy">
          <span className="workspace-import-eyebrow">右键导入</span>
          <h3>选择目标工作区</h3>
          <p>复制导入到目标工作区根目录，不切换当前会话。</p>
        </div>
      </header>

      {errorMessage ? <div className="workspace-import-inline-error">{errorMessage}</div> : null}

      <section className="workspace-import-summary">
        <div className="workspace-import-section-title">
          <strong>待导入项目</strong>
          <span>{request ? `${request.itemCount} 项` : "暂无请求"}</span>
        </div>
        <div className="workspace-import-request-line" title={request?.itemPaths.join("\n") || ""}>
          {previewLabel}
        </div>
      </section>

      <section className="workspace-import-section workspace-import-section-fill">
        <div className="workspace-import-section-title">
          <strong>可用工作区</strong>
          <span>{targets.length} 个目标</span>
        </div>
        <div className="workspace-import-target-list">
          {request
            ? targets.map((target) => (
                <button
                  key={target.id}
                  type="button"
                  className="workspace-import-target"
                  onClick={() => void onSelectTarget(target)}
                  disabled={busy}
                  title={`${target.label}\n${target.rootPath}`}
                >
                  <div className="workspace-import-target-line">
                    <strong className="workspace-import-target-label">{target.label}</strong>
                    <span className="workspace-import-target-badge">
                      {describeTarget(target)}
                    </span>
                    <code className="workspace-import-target-path">{target.rootPath}</code>
                  </div>
                </button>
              ))
            : null}
          {request && targets.length === 0 ? (
            <div className="workspace-import-empty">
              没有可直接写入的工作区，可以浏览目录手动选择目标位置。
            </div>
          ) : null}
          {!request ? (
            <div className="workspace-import-empty">暂无待处理导入请求。</div>
          ) : null}
        </div>
      </section>

      <footer className="workspace-import-card-footer">
        <Button
          type="button"
          variant="outline"
          className="cc-action-btn"
          icon={<FolderOpen size={15} />}
          onClick={() => void onBrowse()}
          disabled={busy || !request}
        >
          浏览其他目录
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="cc-action-btn"
          onClick={() => void onCancel()}
          disabled={busy}
        >
          取消
        </Button>
      </footer>
    </div>
  );
}

export function WorkspaceImportModal(props: WorkspaceImportPickerProps) {
  if (!props.request) {
    return null;
  }

  return (
    <div className="workspace-import-overlay" role="presentation">
      <WorkspaceImportPickerContent {...props} variant="modal" />
    </div>
  );
}

export function WorkspaceImportStandaloneWindow(props: WorkspaceImportPickerProps) {
  return (
    <div className="workspace-import-window-shell">
      <WorkspaceImportPickerContent {...props} variant="window" />
    </div>
  );
}

export function WorkspaceImportResultNotice({
  result,
  onDismiss,
}: WorkspaceImportResultNoticeProps) {
  if (!result) {
    return null;
  }

  const importedLabel =
    result.importedCount === 1 ? result.importedNames[0] ?? "1 项内容" : `${result.importedCount} 项内容`;

  return (
    <div className="workspace-import-notice" role="status" aria-live="polite">
      <div className="workspace-import-notice-copy">
        <strong>已导入到 {result.targetLabel}</strong>
        <p>
          {importedLabel} 已复制到 <code>{result.targetPath}</code>
          {result.currentWorkspaceMatch
            ? "。目标就是当前工作区，若列表未立即更新，可在工作区内手动刷新查看。"
            : "。"}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        icon={<X size={16} />}
        aria-label="关闭导入结果"
        onClick={onDismiss}
      />
    </div>
  );
}