import { useEffect, useState } from "react";
import { ChevronRight, Copy, TerminalSquare, X } from "lucide-react";
import type {
  InstallCommandCatalog,
  InstallCommandEntry,
} from "@/app/types";
import { Button } from "@/components/ui/button";

type InstallCommandsModalProps = {
  open: boolean;
  busy: boolean;
  catalog: InstallCommandCatalog | null;
  installSource: "official" | "mirror";
  onClose: () => void;
};

function getSourceLabel(source: "official" | "mirror") {
  return source === "official" ? "官方源" : "镜像源";
}

function getPowerShellHint(entry: InstallCommandEntry) {
  return entry.requiresElevation ? "需要管理员 PowerShell" : "普通 PowerShell 即可";
}

function getVisibleEntries(
  catalog: InstallCommandCatalog | null,
  installSource: "official" | "mirror",
) {
  return (catalog?.entries ?? []).filter(
    (entry) => entry.source === installSource || entry.source === "shared",
  );
}

function buildCatalogCopyText(
  entries: InstallCommandEntry[],
  installSource: "official" | "mirror",
) {
  if (!entries.length) {
    return "";
  }

  return [
    `# 完整安装命令（${getSourceLabel(installSource)}）`,
    "# 请按界面顺序逐步复制到 PowerShell 执行",
    "",
    ...entries.flatMap((entry) => [
      `# ${entry.title}`,
      `# ${entry.description}`,
      `# ${getPowerShellHint(entry)}`,
      "",
      ...entry.steps.flatMap((step, index) => [
        `# ${index + 1}. ${step.title}`,
        `# ${step.description}`,
        step.command.trim(),
        "",
      ]),
      "",
    ]),
  ]
    .join("\n")
    .trim();
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

function InstallCommandCard({
  entry,
  expanded,
  onToggle,
}: {
  entry: InstallCommandEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <article className={`cc-install-command-card ${expanded ? "expanded" : ""}`}>
      <button
        type="button"
        className="cc-install-command-head"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <div className="cc-install-command-title">
          <h4>{entry.title}</h4>
          <p>{entry.description}</p>
        </div>
        <div className="cc-install-command-summary">
          <span className="cc-install-command-tag">{getPowerShellHint(entry)}</span>
          <span className="cc-install-command-count">{entry.steps.length} 步</span>
          <ChevronRight
            size={16}
            className={`cc-install-command-chevron ${expanded ? "expanded" : ""}`}
            aria-hidden="true"
          />
        </div>
      </button>

      {expanded ? (
        <ol className="cc-install-command-steps">
          {entry.steps.map((step, index) => (
            <li key={step.id} className="cc-install-command-step">
              <div className="cc-install-command-step-head">
                <div className="cc-install-command-step-title">
                  <span className="cc-install-command-step-index">{index + 1}</span>
                  <div>
                    <h5>{step.title}</h5>
                    <p>{step.description}</p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  icon={<Copy size={14} />}
                  className="cc-action-btn"
                  onClick={() => {
                    void copyText(step.command);
                  }}
                >
                  复制这一步
                </Button>
              </div>
              <pre className="cc-install-command-code">{step.command}</pre>
            </li>
          ))}
        </ol>
      ) : null}
    </article>
  );
}

export function InstallCommandsModal({
  open,
  busy,
  catalog,
  installSource,
  onClose,
}: InstallCommandsModalProps) {
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);

  const visibleEntries = getVisibleEntries(catalog, installSource);
  const visibleStepCount = visibleEntries.reduce(
    (total, entry) => total + entry.steps.length,
    0,
  );

  useEffect(() => {
    setExpandedEntryId(null);
  }, [installSource, open]);

  if (!open) {
    return null;
  }

  const handleCopyAll = async () => {
    await copyText(buildCatalogCopyText(visibleEntries, installSource));
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
              disabled={!visibleEntries.length}
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
            <span>{visibleEntries.length} 个条目</span>
          </p>
          <p>{visibleStepCount} 个步骤</p>
        </div>

        <div className="cc-install-commands-modal-body">
          {busy ? (
            <div className="cc-install-commands-empty">
              <div className="spinner" aria-hidden />
              <p>正在加载命令目录…</p>
            </div>
          ) : visibleEntries.length ? (
            <div className="cc-install-command-list">
              {visibleEntries.map((entry) => (
                <InstallCommandCard
                  key={entry.id}
                  entry={entry}
                  expanded={expandedEntryId === entry.id}
                  onToggle={() => {
                    setExpandedEntryId((current) => (current === entry.id ? null : entry.id));
                  }}
                />
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
