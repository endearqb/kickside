// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyKimiCodeAccessInput } from "@/app/shellControllerDefaults";
import { KimiCodeAccessTaskContent } from "./KimiCodeAccessPanel";

describe("KimiCodeAccessTaskContent", () => {
  afterEach(() => cleanup());

  it("shows only the inline API configuration surface", () => {
    const onSave = vi.fn(async () => undefined);
    render(
      <KimiCodeAccessTaskContent
        dirty
        view={null}
        draft={createEmptyKimiCodeAccessInput()}
        testResult={null}
        testing={false}
        saving={false}
        onDraftChange={vi.fn()}
        onSave={onSave}
        onOpenConfigDir={vi.fn(async () => undefined)}
        onTestConnection={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByText("Kimi Code 接入配置")).toBeTruthy();
    expect(screen.getByText("Web Search（可选）")).toBeTruthy();
    expect(screen.getByText("Web Fetch（可选）")).toBeTruthy();
    expect(screen.queryByText("配置文件")).toBeNull();
    expect(screen.queryByText("运行限制")).toBeNull();
    expect(screen.queryByText("恢复默认 URL")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "保存 API 配置" }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("tracks service disclosure state without retaining the React event", () => {
    render(
      <KimiCodeAccessTaskContent
        dirty={false}
        view={null}
        draft={createEmptyKimiCodeAccessInput()}
        testResult={null}
        testing={false}
        saving={false}
        onDraftChange={vi.fn()}
        onSave={vi.fn(async () => undefined)}
        onOpenConfigDir={vi.fn(async () => undefined)}
        onTestConnection={vi.fn(async () => undefined)}
      />,
    );

    for (const label of ["Web Search（可选）", "Web Fetch（可选）"]) {
      const details = screen.getByText(label).closest("details");
      expect(details).toBeTruthy();

      details!.open = true;
      fireEvent(details!, new Event("toggle", { bubbles: true }));
      expect(details!.open).toBe(true);
      details!.open = false;
      fireEvent(details!, new Event("toggle", { bubbles: true }));
      expect(details!.open).toBe(false);
    }
  });

  it("shows synced models and does not call skipped services successful", () => {
    const onDraftChange = vi.fn();
    render(
      <KimiCodeAccessTaskContent
        dirty
        view={null}
        draft={createEmptyKimiCodeAccessInput()}
        testResult={{
          provider: {
            url: "https://api.kimi.com/coding/v1/models",
            reachable: true,
            statusCode: 200,
            state: "verified",
          },
          search: {
            url: "https://api.kimi.com/coding/v1/search",
            reachable: false,
            state: "skipped",
            error: "未发起实际搜索请求",
          },
          fetch: {
            url: "https://api.kimi.com/coding/v1/fetch",
            reachable: false,
            state: "skipped",
            error: "未发起实际抓取请求",
          },
          apiKeyConfigured: true,
          models: [
            {
              id: "kimi-code/k3",
              provider: "managed:kimi-code",
              model: "k3",
              maxContextSize: 1048576,
              exists: true,
              capabilities: ["thinking", "tool_use"],
              displayName: "K3",
              supportEfforts: ["max"],
              defaultEffort: "max",
            },
          ],
          warnings: [],
        }}
        testing={false}
        saving={false}
        onDraftChange={onDraftChange}
        onSave={vi.fn(async () => undefined)}
        onOpenConfigDir={vi.fn(async () => undefined)}
        onTestConnection={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByRole("option", { name: "K3 · kimi-code/k3" })).toBeTruthy();
    expect(screen.getByText("已验证")).toBeTruthy();
    expect(screen.getAllByText("未测试")).toHaveLength(2);
  });

  it("shows a 404 model probe as failed", () => {
    render(
      <KimiCodeAccessTaskContent
        dirty
        view={null}
        draft={createEmptyKimiCodeAccessInput()}
        testResult={{
          provider: {
            url: "https://example.invalid/models",
            reachable: false,
            statusCode: 404,
            state: "failed",
            error: "模型接口返回 HTTP 404",
          },
          search: { url: "", reachable: false, state: "skipped" },
          fetch: { url: "", reachable: false, state: "skipped" },
          apiKeyConfigured: true,
          models: [],
          warnings: [],
        }}
        testing={false}
        saving={false}
        onDraftChange={vi.fn()}
        onSave={vi.fn(async () => undefined)}
        onOpenConfigDir={vi.fn(async () => undefined)}
        onTestConnection={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByText("失败")).toBeTruthy();
    expect(screen.getByText("模型接口返回 HTTP 404")).toBeTruthy();
  });
});
