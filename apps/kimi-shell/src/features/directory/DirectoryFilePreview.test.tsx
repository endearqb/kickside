// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DirectoryFilePreview, MarkdownPreview } from "./DirectoryFilePreview";

describe("MarkdownPreview", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders raw html as text instead of DOM nodes", () => {
    const { container } = render(
      <MarkdownPreview text={"# Demo\n<script>alert(1)</script>\n<img src=x onerror=alert(1)>"} />,
    );

    expect(container.textContent).toContain("<script>alert(1)</script>");
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("disables javascript links", () => {
    render(<MarkdownPreview text={"[bad](javascript:alert(1))"} onOpenLink={() => undefined} />);

    expect((screen.getByRole("button", { name: "bad" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("replaces markdown images with a non-loading placeholder", () => {
    const { container } = render(<MarkdownPreview text={"![logo](./logo.png)"} />);

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("img", { name: "图片占位：logo" })).toBeTruthy();
    expect(container.textContent).toContain("图片已隐藏");
  });

  it("moves selected files with arrow keys", async () => {
    const readFile = vi.fn(async (relPath: string) => ({
      relPath,
      size: relPath.length,
      isBinary: false,
      truncated: false,
      text: `# ${relPath}`,
    }));

    render(
      <DirectoryFilePreview
        entityKey="skill:test"
        description="Demo"
        loadEntries={async () => [
          { relPath: "SKILL.md", isDir: false },
          { relPath: "README.md", isDir: false },
        ]}
        readFile={readFile}
      />,
    );

    const first = await screen.findByRole("treeitem", { name: /SKILL.md/ });
    const second = await screen.findByRole("treeitem", { name: /README.md/ });
    expect(first.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(first, { key: "ArrowDown" });

    await waitFor(() => expect(second.getAttribute("aria-selected")).toBe("true"));
  });

  it("collapses directories by default and expands them with ArrowRight", async () => {
    const readFile = vi.fn(async (relPath: string) => ({
      relPath,
      size: relPath.length,
      isBinary: false,
      truncated: false,
      text: `# ${relPath}`,
    }));

    render(
      <DirectoryFilePreview
        entityKey="skill:tree"
        description="Demo"
        loadEntries={async () => [
          { relPath: "SKILL.md", isDir: false },
          { relPath: "docs", isDir: true },
          { relPath: "docs/README.md", isDir: false },
        ]}
        readFile={readFile}
      />,
    );

    const docs = await screen.findByRole("treeitem", { name: /docs/ });
    expect(screen.queryByRole("treeitem", { name: /README.md/ })).toBeNull();

    fireEvent.keyDown(docs, { key: "ArrowRight" });
    expect(await screen.findByRole("treeitem", { name: /README.md/ })).toBeTruthy();

    fireEvent.keyDown(docs, { key: "ArrowLeft" });
    await waitFor(() => expect(screen.queryByRole("treeitem", { name: /README.md/ })).toBeNull());
  });

  it("keeps root license files at the end of the tree", async () => {
    const readFile = vi.fn(async (relPath: string) => ({
      relPath,
      size: relPath.length,
      isBinary: false,
      truncated: false,
      text: `# ${relPath}`,
    }));

    render(
      <DirectoryFilePreview
        entityKey="skill:license"
        description="Demo"
        loadEntries={async () => [
          { relPath: "SKILL.md", isDir: false },
          { relPath: "LICENSE", isDir: false },
          { relPath: "README.md", isDir: false },
        ]}
        readFile={readFile}
      />,
    );

    const items = await screen.findAllByRole("treeitem");
    expect(items.map((item) => item.textContent)).toEqual(["SKILL.md", "README.md", "LICENSE"]);
  });

  it("resets content scroll when switching files", async () => {
    const scrollTo = vi.fn();
    const originalScrollTo = HTMLElement.prototype.scrollTo;
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scrollTo });
    const readFile = vi.fn(async (relPath: string) => ({
      relPath,
      size: relPath.length,
      isBinary: false,
      truncated: false,
      text: `# ${relPath}`,
    }));

    render(
      <DirectoryFilePreview
        entityKey="skill:scroll"
        description="Demo"
        loadEntries={async () => [
          { relPath: "SKILL.md", isDir: false },
          { relPath: "README.md", isDir: false },
        ]}
        readFile={readFile}
      />,
    );

    const second = await screen.findByRole("treeitem", { name: /README.md/ });
    scrollTo.mockClear();
    fireEvent.click(second);

    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 0 }));
    if (originalScrollTo) {
      Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: originalScrollTo });
    } else {
      delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
    }
  });

  it("opens relative markdown links from the current file directory", async () => {
    const readFile = vi.fn(async (relPath: string) => ({
      relPath,
      size: relPath.length,
      isBinary: false,
      truncated: false,
      text: relPath === "docs/intro.md" ? "[Next](./next.md)" : "# Next",
    }));

    render(
      <DirectoryFilePreview
        entityKey="skill:links"
        description="Demo"
        loadEntries={async () => [
          { relPath: "docs", isDir: true },
          { relPath: "docs/intro.md", isDir: false },
          { relPath: "docs/next.md", isDir: false },
        ]}
        readFile={readFile}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Next" }));

    const next = await screen.findByRole("treeitem", { name: /next.md/ });
    await waitFor(() => expect(next.getAttribute("aria-selected")).toBe("true"));
  });

  it("shows a placeholder for truncated files", async () => {
    const onOpenRoot = vi.fn();

    render(
      <DirectoryFilePreview
        entityKey="skill:truncated"
        description="Demo"
        loadEntries={async () => [{ relPath: "big.md", isDir: false }]}
        readFile={async () => ({
          relPath: "big.md",
          size: 600_000,
          isBinary: false,
          truncated: true,
          text: "# partial",
        })}
        onOpenRoot={onOpenRoot}
      />,
    );

    expect(await screen.findByText("文件超过预览上限，不在控制中心内渲染截断内容。")).toBeTruthy();
    expect(screen.queryByText("# partial")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "打开所在目录" }));
    expect(onOpenRoot).toHaveBeenCalledOnce();
  });

  it("shows an error state with a return button when file loading fails", async () => {
    render(
      <DirectoryFilePreview
        entityKey="skill:error"
        description="Demo"
        loadEntries={async () => [{ relPath: "broken.md", isDir: false }]}
        readFile={async () => {
          throw new Error("boom");
        }}
      />,
    );

    expect(await screen.findByText("文件加载失败")).toBeTruthy();
    expect(screen.getByText("boom")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "返回文件列表" }));
    expect(await screen.findByText("选择一个文件查看内容。")).toBeTruthy();
  });
});
