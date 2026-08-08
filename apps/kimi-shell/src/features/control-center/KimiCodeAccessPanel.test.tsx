// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KimiCodeAccessTaskContent } from "./KimiCodeAccessPanel";

describe("KimiCodeAccessTaskContent", () => {
  afterEach(() => cleanup());

  it("keeps authentication diagnostics and delegates configuration to Kimi Code Web", () => {
    const onOpenKimiCodeSettings = vi.fn();
    render(
      <KimiCodeAccessTaskContent
        authMode="provider_api"
        activeProvider="managed:kimi-code"
        providerApiConfigured
        kimiLoginHealth={{
          state: "auth_required",
          source: "workspace_api",
          message: "Kimi 登录需要刷新。",
          checkedAtMs: 1_720_000_000_000,
          needsAttention: true,
        }}
        providerApiHealth={{
          state: "error",
          source: "backend_startup",
          message: "Provider API 连接异常。",
          checkedAtMs: 1_720_000_000_000,
          needsAttention: true,
        }}
        onOpenKimiCodeSettings={onOpenKimiCodeSettings}
      />,
    );

    expect(screen.getByText("Provider API", { selector: "dd" })).toBeTruthy();
    expect(screen.getByText(/需要重新登录 · 工作区接口/)).toBeTruthy();
    expect(screen.getByText(/配置或运行异常 · managed:kimi-code/)).toBeTruthy();
    expect(screen.getByText(/Kimi 登录需要刷新/)).toBeTruthy();
    expect(screen.getByText(/Provider API 连接异常/)).toBeTruthy();
    expect(screen.getByText(/Kimi Code Web 内置设置中完成/)).toBeTruthy();

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "保存 API 配置" })).toBeNull();
    expect(screen.queryByRole("button", { name: "验证 API 并同步模型" })).toBeNull();
    expect(screen.queryByRole("button", { name: "打开配置目录" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "返回 Kimi Code Web" }));
    expect(onOpenKimiCodeSettings).toHaveBeenCalledOnce();
  });

  it("shows both unconfigured and unknown authentication states without edit controls", () => {
    render(
      <KimiCodeAccessTaskContent
        authMode="unknown"
        providerApiConfigured={false}
        onOpenKimiCodeSettings={vi.fn()}
      />,
    );

    expect(screen.getAllByText("未知").length).toBeGreaterThan(0);
    expect(screen.getByText("未配置")).toBeTruthy();
    expect(screen.getAllByText(/暂无诊断信息/)).toHaveLength(2);
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
