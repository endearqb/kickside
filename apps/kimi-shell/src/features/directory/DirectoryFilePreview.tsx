import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronRight, Copy, FileText } from "lucide-react";
import { ask } from "@tauri-apps/plugin-dialog";
import type { SkillFileContent, SkillFileEntry } from "@/app/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type FileMode = "preview" | "source";

type DirectoryFilePreviewProps = {
  entityKey: string;
  description: string;
  loadEntries: () => Promise<SkillFileEntry[]>;
  readFile: (relPath: string) => Promise<SkillFileContent>;
  onOpenRoot?: () => Promise<void> | void;
  className?: string;
  showDescription?: boolean;
  onOpenExternalUrl?: (url: string) => Promise<void> | void;
};

export function DirectoryFilePreview({
  entityKey,
  description,
  loadEntries,
  readFile,
  onOpenRoot,
  className,
  showDescription = true,
  onOpenExternalUrl,
}: DirectoryFilePreviewProps) {
  const [entries, setEntries] = useState<SkillFileEntry[] | null>(null);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState("");
  const [content, setContent] = useState<SkillFileContent | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [fileModes, setFileModes] = useState<Record<string, FileMode>>({});
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set());
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [treeFocusPath, setTreeFocusPath] = useState("");
  const treeItemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const contentPaneRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setEntriesError(null);
    setContent(null);
    setContentError(null);
    setSelectedPath("");
    setFileModes({});
    setExpandedDirs(new Set());
    setTreeFocusPath("");

    loadEntries()
      .then((nextEntries) => {
        if (cancelled) return;
        const defaultPath = pickDefaultFile(nextEntries) ?? "";
        setEntries(nextEntries);
        setSelectedPath(defaultPath);
        setTreeFocusPath(defaultPath || nextEntries[0]?.relPath || "");
        setExpandedDirs(new Set(parentDirs(defaultPath)));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setEntriesError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [entityKey, loadEntries]);

  useEffect(() => {
    if (!selectedPath) {
      setContent(null);
      setContentError(null);
      return;
    }

    let cancelled = false;
    setContent(null);
    setContentError(null);
    setCopied(false);
    readFile(selectedPath)
      .then((nextContent) => {
        if (!cancelled) setContent(nextContent);
      })
      .catch((error: unknown) => {
        if (!cancelled) setContentError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [entityKey, readFile, selectedPath]);

  useEffect(() => {
    contentPaneRef.current?.scrollTo?.({ top: 0 });
  }, [selectedPath]);

  const selectedEntry = useMemo(
    () => entries?.find((entry) => entry.relPath === selectedPath) ?? null,
    [entries, selectedPath],
  );
  const displayEntries = useMemo(() => orderTreeEntries(entries ?? []), [entries]);
  const visibleEntries = useMemo(() => {
    if (!entries) return [];
    const directoryPaths = new Set(displayEntries.filter((entry) => entry.isDir).map((entry) => entry.relPath));
    return displayEntries.filter((entry) =>
      parentDirs(entry.relPath).every((parent) => !directoryPaths.has(parent) || expandedDirs.has(parent)),
    );
  }, [displayEntries, entries, expandedDirs]);
  const licenseEntry = useMemo(
    () => displayEntries.find((entry) => isRootLicenseEntry(entry)) ?? null,
    [displayEntries],
  );
  const showTextContent = Boolean(content?.text && !content.isBinary && !content.truncated);
  const canPreview = Boolean(showTextContent && content && isMarkdownPath(content.relPath));
  const activeMode = selectedPath
    ? fileModes[selectedPath] ?? (canPreview ? "preview" : "source")
    : "source";
  const effectiveTreeFocusPath = visibleEntries.some((entry) => entry.relPath === treeFocusPath)
    ? treeFocusPath
    : visibleEntries.find((entry) => entry.relPath === selectedPath)?.relPath ??
      visibleEntries[0]?.relPath ??
      "";

  function setMode(mode: FileMode) {
    if (!selectedPath) return;
    setFileModes((current) => ({ ...current, [selectedPath]: mode }));
  }

  function selectFilePath(relPath: string, focus = false) {
    setSelectedPath(relPath);
    setTreeFocusPath(relPath);
    setExpandedDirs((current) => new Set([...current, ...parentDirs(relPath)]));
    if (focus) {
      window.requestAnimationFrame(() => treeItemRefs.current[relPath]?.focus());
    }
  }

  function toggleDirectory(relPath: string, expanded?: boolean) {
    setExpandedDirs((current) => {
      const next = new Set(current);
      const shouldExpand = expanded ?? !next.has(relPath);
      if (shouldExpand) next.add(relPath);
      else next.delete(relPath);
      return next;
    });
  }

  function focusTreeEntry(entry: SkillFileEntry | undefined) {
    if (!entry) return;
    if (!entry.isDir) selectFilePath(entry.relPath, true);
    else {
      setTreeFocusPath(entry.relPath);
      window.requestAnimationFrame(() => treeItemRefs.current[entry.relPath]?.focus());
    }
  }

  function handleTreeItemKeyDown(event: KeyboardEvent<HTMLButtonElement>, entry: SkillFileEntry) {
    const currentIndex = visibleEntries.findIndex((item) => item.relPath === entry.relPath);
    if (currentIndex < 0) return;

    if (entry.isDir && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
      event.preventDefault();
      toggleDirectory(entry.relPath, event.key === "ArrowRight");
      return;
    }

    const nextEntry =
      event.key === "ArrowDown"
        ? visibleEntries[Math.min(currentIndex + 1, visibleEntries.length - 1)]
        : event.key === "ArrowUp"
          ? visibleEntries[Math.max(currentIndex - 1, 0)]
          : event.key === "Home"
            ? visibleEntries[0]
            : event.key === "End"
              ? visibleEntries[visibleEntries.length - 1]
              : null;

    if (nextEntry) {
      event.preventDefault();
      focusTreeEntry(nextEntry);
    }
  }

  async function copyCurrentFile() {
    if (!content?.text || content.truncated) return;
    setCopyError("");
    try {
      await navigator.clipboard.writeText(content.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyError("复制失败，请检查系统剪贴板权限。");
    }
  }

  async function openMarkdownLink(href: string) {
    if (/^\s*javascript:/i.test(href)) return;
    const normalized = resolveRelativeFilePath(selectedPath, href);
    const linkedEntry = entries?.find((entry) => !entry.isDir && entry.relPath === normalized);
    if (linkedEntry) {
      setSelectedPath(linkedEntry.relPath);
      return;
    }
    if (!/^https?:\/\//i.test(href)) return;
    let confirmed = false;
    try {
      confirmed = await ask("将在系统默认浏览器中打开此链接。", {
        title: "打开外部链接",
        kind: "info",
        okLabel: "打开浏览器",
        cancelLabel: "取消",
      });
    } catch {
      confirmed = window.confirm("在系统浏览器打开外部链接？");
    }
    if (!confirmed) return;
    if (onOpenExternalUrl) await onOpenExternalUrl(href);
    else window.open(href, "_blank", "noopener,noreferrer");
  }

  return (
    <div className={cn("directory-file-preview", className)}>
      {showDescription ? (
        <section className="directory-description-card">
          <div>
            <span className="directory-eyebrow">Description</span>
            <p>{description}</p>
            {licenseEntry ? (
              <button
                type="button"
                className="directory-license-link"
                onClick={() => setSelectedPath(licenseEntry.relPath)}
              >
                License 完整条款见 {licenseEntry.relPath}
              </button>
            ) : null}
          </div>
          <DirectoryPreviewActions
            canPreview={canPreview}
            selectedPath={selectedPath}
            copied={copied}
            contentText={content?.text}
            contentTruncated={content?.truncated}
            onPreview={() => setMode("preview")}
            onSource={() => setMode("source")}
            onCopy={() => void copyCurrentFile()}
          />
        </section>
      ) : null}

      <div className="directory-preview-layout">
        <aside className="directory-file-tree" aria-label="Skill 文件树" role="tree">
          {entriesError ? <p className="directory-preview-error">{entriesError}</p> : null}
          {!entries && !entriesError ? <p className="directory-muted">正在读取文件列表...</p> : null}
          {entries?.length === 0 ? <p className="directory-muted">没有可预览文件。</p> : null}
          {entries && entries.length >= 512 ? (
            <p className="directory-muted">最多显示 512 个文件，打开目录可查看完整内容。</p>
          ) : null}
          {visibleEntries.map((entry) => (
            <button
              key={entry.relPath}
              type="button"
              className={cn(
                "directory-file-tree-row",
                entry.isDir ? "is-dir" : null,
                selectedPath === entry.relPath ? "is-active" : null,
              )}
              style={{ paddingLeft: `${10 + fileDepth(entry.relPath) * 14}px` }}
              role="treeitem"
              aria-selected={selectedPath === entry.relPath}
              aria-level={fileDepth(entry.relPath) + 1}
              aria-expanded={entry.isDir ? expandedDirs.has(entry.relPath) : undefined}
              tabIndex={effectiveTreeFocusPath === entry.relPath ? 0 : -1}
              ref={(node) => {
                treeItemRefs.current[entry.relPath] = node;
              }}
              onClick={() => (entry.isDir ? toggleDirectory(entry.relPath) : selectFilePath(entry.relPath))}
              onFocus={() => setTreeFocusPath(entry.relPath)}
              onKeyDown={(event) => handleTreeItemKeyDown(event, entry)}
              title={entry.relPath}
            >
              {entry.isDir ? (
                <ChevronRight
                  className={cn(
                    "directory-file-tree-chevron",
                    expandedDirs.has(entry.relPath) ? "is-expanded" : null,
                  )}
                  size={14}
                />
              ) : (
                <FileText size={14} />
              )}
              <span>{fileName(entry.relPath)}</span>
            </button>
          ))}
        </aside>

        <section ref={contentPaneRef} className="directory-file-content">
          <span className="sr-only" role="status" aria-live="polite">
            {copyError || (copied ? "已复制当前文件" : "")}
          </span>
          {!showDescription && selectedPath && !entriesError && !contentError ? (
            <div className="directory-file-content-header">
              <strong>{selectedEntry?.relPath ?? content?.relPath ?? selectedPath}</strong>
              <DirectoryPreviewActions
                canPreview={canPreview}
                selectedPath={selectedPath}
                copied={copied}
                contentText={content?.text}
                contentTruncated={content?.truncated}
                onPreview={() => setMode("preview")}
                onSource={() => setMode("source")}
                onCopy={() => void copyCurrentFile()}
              />
            </div>
          ) : null}
          {entriesError ? (
            <div className="directory-file-error-state" role="alert">
              <strong>文件列表加载失败</strong>
              <p>{entriesError}</p>
              {onOpenRoot ? (
                <Button type="button" variant="outline" onClick={() => void onOpenRoot()}>
                  打开所在目录
                </Button>
              ) : null}
            </div>
          ) : null}
          {contentError ? (
            <div className="directory-file-error-state" role="alert">
              <strong>文件加载失败</strong>
              <p>{contentError}</p>
              <Button type="button" variant="outline" onClick={() => setSelectedPath("")}>
                返回文件列表
              </Button>
            </div>
          ) : null}
          {selectedPath && !content && !contentError && !entriesError ? <p className="directory-muted">正在读取文件...</p> : null}
          {!selectedPath && entries && !entriesError ? <p className="directory-muted">选择一个文件查看内容。</p> : null}
          {content?.isBinary ? (
            <div className="directory-file-placeholder">
              <strong>{content.relPath}</strong>
              <p>二进制文件只读占位，不在控制中心内渲染。</p>
              {onOpenRoot ? (
                <Button type="button" variant="outline" onClick={() => void onOpenRoot()}>
                  打开所在目录
                </Button>
              ) : null}
            </div>
          ) : null}
          {content?.truncated && !content.isBinary ? (
            <div className="directory-file-placeholder">
              <strong>{content.relPath}</strong>
              <p>文件超过预览上限，不在控制中心内渲染截断内容。</p>
              {onOpenRoot ? (
                <Button type="button" variant="outline" onClick={() => void onOpenRoot()}>
                  打开所在目录
                </Button>
              ) : null}
            </div>
          ) : null}
          {showTextContent && content?.text ? (
            <>
              {showDescription ? (
                <div className="directory-file-content-header">
                  <strong>{selectedEntry?.relPath ?? content.relPath}</strong>
                </div>
              ) : null}
              {activeMode === "preview" && canPreview ? (
                <MarkdownPreview text={content.text} onOpenLink={(href) => void openMarkdownLink(href)} />
              ) : (
                <pre className="directory-code-viewer">{content.text}</pre>
              )}
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function DirectoryPreviewActions({
  canPreview,
  selectedPath,
  copied,
  contentText,
  contentTruncated,
  onPreview,
  onSource,
  onCopy,
  className,
}: {
  canPreview: boolean;
  selectedPath: string;
  copied: boolean;
  contentText?: string;
  contentTruncated?: boolean;
  onPreview: () => void;
  onSource: () => void;
  onCopy: () => void;
  className?: string;
}) {
  return (
    <div className={cn("directory-preview-actions", className)}>
      <Button type="button" variant="outline" size="sm" onClick={onPreview} disabled={!canPreview}>
        预览
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={onSource} disabled={!selectedPath}>
        源码
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        icon={copied ? <Check size={15} /> : <Copy size={15} />}
        onClick={onCopy}
        disabled={!contentText || contentTruncated}
        aria-label="复制当前文件"
        title="复制当前文件"
      />
    </div>
  );
}

export function MarkdownPreview({
  text,
  onOpenLink,
}: {
  text: string;
  onOpenLink?: (href: string) => void;
}) {
  const { frontmatter, body } = splitFrontmatter(text);
  return (
    <div className="directory-markdown-viewer">
      {frontmatter ? (
        <details>
          <summary>查看 frontmatter</summary>
          <pre>{frontmatter}</pre>
        </details>
      ) : null}
      {renderMarkdownBlocks(body, onOpenLink)}
    </div>
  );
}

function splitFrontmatter(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---\n")) return { frontmatter: "", body: normalized };
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) return { frontmatter: "", body: normalized };
  return {
    frontmatter: normalized.slice(4, end),
    body: normalized.slice(end + "\n---\n".length),
  };
}

function renderMarkdownBlocks(text: string, onOpenLink?: (href: string) => void) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push(<pre key={blocks.length}>{code.join("\n")}</pre>);
      continue;
    }

    if (/^#{1,4}\s/.test(trimmed)) {
      const level = Math.min(trimmed.match(/^#+/)?.[0].length ?? 1, 4);
      const children = renderInline(trimmed.replace(/^#{1,4}\s*/, ""), onOpenLink);
      const Heading = `h${level}` as "h1" | "h2" | "h3" | "h4";
      blocks.push(<Heading key={blocks.length}>{children}</Heading>);
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(<li key={items.length}>{renderInline(lines[index].trim().replace(/^[-*]\s+/, ""), onOpenLink)}</li>);
        index += 1;
      }
      blocks.push(<ul key={blocks.length}>{items}</ul>);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(<li key={items.length}>{renderInline(lines[index].trim().replace(/^\d+\.\s+/, ""), onOpenLink)}</li>);
        index += 1;
      }
      blocks.push(<ol key={blocks.length}>{items}</ol>);
      continue;
    }

    if (trimmed.startsWith(">")) {
      blocks.push(<blockquote key={blocks.length}>{renderInline(trimmed.replace(/^>\s?/, ""), onOpenLink)}</blockquote>);
      index += 1;
      continue;
    }

    if (/^-{3,}$/.test(trimmed)) {
      blocks.push(<hr key={blocks.length} />);
      index += 1;
      continue;
    }

    if (looksLikeTable(lines, index)) {
      const tableRows: string[][] = [];
      tableRows.push(splitTableLine(lines[index]));
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        tableRows.push(splitTableLine(lines[index]));
        index += 1;
      }
      blocks.push(renderTable(tableRows, blocks.length, onOpenLink));
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(<p key={blocks.length}>{renderInline(paragraph.join(" "), onOpenLink)}</p>);
  }

  return blocks;
}

function renderInline(text: string, onOpenLink?: (href: string) => void) {
  const parts: ReactNode[] = [];
  const pattern = /(!\[([^\]]*)\]\(([^)]+)\)|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\*\*(.+?)\*\*|__(.+?)__)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[2] !== undefined) {
      const alt = match[2].trim();
      const src = match[3]?.trim() ?? "";
      parts.push(
        <span
          key={parts.length}
          className="directory-markdown-image-placeholder"
          role="img"
          aria-label={alt ? `图片占位：${alt}` : "图片占位"}
        >
          图片已隐藏
          <code>{alt || src}</code>
        </span>,
      );
    } else if (match[4]) {
      parts.push(<code key={parts.length}>{match[4]}</code>);
    } else if (match[7] !== undefined || match[8] !== undefined) {
      parts.push(
        <strong key={parts.length}>{renderInline(match[7] ?? match[8] ?? "", onOpenLink)}</strong>,
      );
    } else {
      const label = match[5] ?? match[6] ?? "";
      const href = match[6] ?? "";
      const disabled = !onOpenLink || /^\s*javascript:/i.test(href);
      parts.push(
        <button
          key={parts.length}
          type="button"
          className="directory-markdown-link"
          disabled={disabled}
          onClick={() => onOpenLink?.(href)}
        >
          {label}
        </button>,
      );
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

function looksLikeTable(lines: string[], index: number) {
  return (
    lines[index]?.includes("|") &&
    /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1] ?? "")
  );
}

function splitTableLine(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderTable(rows: string[][], key: number, onOpenLink?: (href: string) => void) {
  const [head, ...body] = rows;
  return (
    <table key={key}>
      <thead>
        <tr>{head.map((cell, index) => <th key={index}>{renderInline(cell, onOpenLink)}</th>)}</tr>
      </thead>
      <tbody>
        {body.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((cell, cellIndex) => <td key={cellIndex}>{renderInline(cell, onOpenLink)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function isBlockStart(line: string) {
  const trimmed = line.trim();
  return (
    /^#{1,4}\s/.test(trimmed) ||
    /^[-*]\s+/.test(trimmed) ||
    /^\d+\.\s+/.test(trimmed) ||
    trimmed.startsWith(">") ||
    trimmed.startsWith("```") ||
    /^-{3,}$/.test(trimmed) ||
    trimmed === ""
  );
}

function pickDefaultFile(entries: SkillFileEntry[]) {
  const files = entries.filter((entry) => !entry.isDir);
  return (
    files.find((entry) => entry.relPath.toUpperCase() === "SKILL.MD")?.relPath ??
    files.find((entry) => entry.relPath.toUpperCase() === "README.MD")?.relPath ??
    files.find((entry) => isMarkdownPath(entry.relPath))?.relPath ??
    files[0]?.relPath
  );
}

function isMarkdownPath(path: string) {
  return /\.(md|markdown)$/i.test(path);
}

function fileDepth(path: string) {
  return Math.max(path.split("/").length - 1, 0);
}

function parentDirs(path: string) {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

function isRootLicenseEntry(entry: SkillFileEntry) {
  return !entry.isDir && !entry.relPath.includes("/") && entry.relPath.toUpperCase().startsWith("LICENSE");
}

function resolveRelativeFilePath(currentPath: string, href: string) {
  const cleanHref = href.split(/[?#]/, 1)[0]?.replace(/\\/g, "/").replace(/^\/+/, "") ?? "";
  const baseParts = currentPath.includes("/") ? currentPath.split("/").slice(0, -1) : [];
  const parts = (href.startsWith("/") ? [] : baseParts).concat(cleanHref.split("/"));
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return resolved.join("/");
}

function orderTreeEntries(entries: SkillFileEntry[]) {
  return [...entries].sort((left, right) => Number(isRootLicenseEntry(left)) - Number(isRootLicenseEntry(right)));
}

function fileName(path: string) {
  return path.split("/").pop() || path;
}
