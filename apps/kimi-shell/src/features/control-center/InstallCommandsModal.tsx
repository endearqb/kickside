import { Copy, TerminalSquare, X } from "lucide-react";
import type { InstallCommandCatalog, InstallCommandEntry } from "@/app/types";
import { Button } from "@/components/ui/button";

type InstallCommandsModalProps = {
  open: boolean;
  busy: boolean;
  catalog: InstallCommandCatalog | null;
  onClose: () => void;
};

function buildCatalogCopyText(catalog: InstallCommandCatalog | null) {
  if (!catalog?.entries.length) {
    return "";
  }
  return catalog.entries
    .map(
      (entry) =>
        `# ${entry.title}\n# ${entry.description}\n# ${
          entry.requiresElevation ? "需要管理员权限" : "普通用户权限"
        }\n${entry.command.trim()}`,
    )
    .join("\n\n");
}

async function copyText(value: string) {
  if (!value.trim()) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  }
}

function InstallCommandCard({ entry }: { entry: InstallCommandEntry }) {
  const handleCopy = async () => {
    await copyText(entry.command);
  };

  return (
    <article className="cc-install-command-card">
      <header className="cc-install-command-head">
        <div className="cc-install-command-title">
          <h4>{entry.title}</h4>
          <p>{entry.description}</p>
        </div>
        <div className="cc-install-command-actions">
          <span className="cc-install-command-tag">
            {entry.requiresElevation ? "需要管理员权限" : "普通用户权限"}
          </span>
          <Button
            type="button"
            variant="outline"
            icon={<Copy size={14} />}
            className="cc-action-btn"
            onClick={() => {
              void handleCopy();
            }}
          >
            复制命令
          </Button>
        </div>
      </header>
      <pre className="cc-install-command-code">{entry.command}</pre>
    </article>
  );
}

export function InstallCommandsModal({
  open,
  busy,
  catalog,
  onClose,
}: InstallCommandsModalProps) {
  if (!open) {
    return null;
  }

  const handleCopyAll = async () => {
    await copyText(buildCatalogCopyText(catalog));
  };

  return (
    <div
      className="cc-install-commands-modal-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="cc-install-commands-modal"
        role="dialog"
        aria-modal="true"
        aria-label="完整安装命令"
      >
        <header className="cc-install-commands-modal-header">
          <div className="cc-install-commands-modal-title">
            <h3>完整安装命令</h3>
            <p>可直接复制到 PowerShell 手动执行，命令内容与当前产品安装脚本保持同源。</p>
          </div>
          <div className="cc-install-commands-modal-actions">
            <Button
              type="button"
              variant="outline"
              icon={<Copy size={14} />}
              className="cc-action-btn"
              onClick={() => {
                void handleCopyAll();
              }}
              disabled={!catalog?.entries.length}
            >
              复制全部
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              icon={<X size={16} />}
              onClick={onClose}
              aria-label="关闭完整安装命令弹窗"
            />
          </div>
        </header>

        <div className="cc-install-commands-modal-meta">
          <p>
            <TerminalSquare size={14} />
            <span>{catalog?.entries.length ?? 0} 段命令</span>
          </p>
          <p>建议在 PowerShell 中执行，多行脚本请整段粘贴。</p>
        </div>

        <div className="cc-install-commands-modal-body">
          {busy ? (
            <div className="cc-install-commands-empty">
              <div className="spinner" aria-hidden />
              <p>正在加载命令目录…</p>
            </div>
          ) : catalog?.entries.length ? (
            <div className="cc-install-command-list">
              {catalog.entries.map((entry) => (
                <InstallCommandCard key={entry.id} entry={entry} />
              ))}
            </div>
          ) : (
            <div className="cc-install-commands-empty">
              <p>当前没有可展示的安装命令。</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
