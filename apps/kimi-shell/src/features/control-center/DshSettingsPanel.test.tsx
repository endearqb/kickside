// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as dshService from "@/services/dshService";
import { DshSettingsPanel } from "./DshSettingsPanel";

vi.mock("@/services/dshService", () => ({
  getDshLogTail: vi.fn(async () => []),
  getDshPreflight: vi.fn(),
  getDshSettings: vi.fn(),
  getDshStatus: vi.fn(),
  installDsh: vi.fn(),
  saveDshSettings: vi.fn(),
  startDsh: vi.fn(),
  stopDsh: vi.fn(),
}));

describe("DshSettingsPanel", () => {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.clearAllMocks();
  });

  it("renders as a branded update-list row and explains default-workspace auto start", async () => {
    vi.mocked(dshService.getDshSettings).mockResolvedValue({
      enabled: true,
      portRange: [3080, 3179],
      startTimeoutSec: 60,
      pinnedVersion: "0.1.0-rc.6",
    });
    vi.mocked(dshService.getDshPreflight).mockResolvedValue({
      ready: true,
      nodePath: "/opt/homebrew/bin/node",
      nodeVersion: "v24.19.0",
      npmPath: "/opt/homebrew/bin/npm",
      installedVersion: "0.1.0-rc.6",
      pinnedVersion: "0.1.0-rc.6",
      installPath: "/tmp/dsh",
      issues: [],
    });
    vi.mocked(dshService.getDshStatus).mockResolvedValue({
      state: "running",
      workspaceDir: "/Users/qian/work/demo",
      pinnedVersion: "0.1.0-rc.6",
    });

    const onExpandedChange = vi.fn();
    const { container, rerender } = render(
      <ul><DshSettingsPanel expanded={false} onExpandedChange={onExpandedChange} /></ul>,
    );

    await waitFor(() => expect(screen.getByText("运行中 · demo")).toBeTruthy());
    expect(container.querySelector("li.cc-settings-bar")).toBeTruthy();
    expect(container.querySelector('[data-settings-row="dsh"]')).toBeTruthy();
    expect(container.querySelector('[data-backend-brand="dsh"]')).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "启用 DeepSeek Harness" }) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /DeepSeek Harness/ }));
    expect(onExpandedChange).toHaveBeenCalledWith(true);
    rerender(<ul><DshSettingsPanel expanded onExpandedChange={onExpandedChange} /></ul>);
    expect(screen.getByText(/随 KickSide 启动，并自动加载默认工作区/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新安装固定版本" })).toBeTruthy();
  });

  it("keeps the enable switch independent from disclosure expansion", async () => {
    vi.mocked(dshService.getDshSettings).mockResolvedValue({
      enabled: false,
      portRange: [3080, 3179],
      startTimeoutSec: 60,
      pinnedVersion: "0.1.0-rc.6",
    });
    vi.mocked(dshService.getDshPreflight).mockResolvedValue({
      ready: true,
      nodePath: "/opt/homebrew/bin/node",
      nodeVersion: "v24.19.0",
      npmPath: "/opt/homebrew/bin/npm",
      installedVersion: "0.1.0-rc.6",
      pinnedVersion: "0.1.0-rc.6",
      installPath: "/tmp/dsh",
      issues: [],
    });
    vi.mocked(dshService.getDshStatus).mockResolvedValue({
      state: "stopped",
      pinnedVersion: "0.1.0-rc.6",
    });
    vi.mocked(dshService.saveDshSettings).mockResolvedValue({
      enabled: true,
      portRange: [3080, 3179],
      startTimeoutSec: 60,
      pinnedVersion: "0.1.0-rc.6",
    });

    const onExpandedChange = vi.fn();
    render(<ul><DshSettingsPanel expanded={false} onExpandedChange={onExpandedChange} /></ul>);

    const toggle = await screen.findByRole("checkbox", { name: "启用 DeepSeek Harness" });
    fireEvent.click(toggle);

    await waitFor(() => expect(dshService.saveDshSettings).toHaveBeenCalled());
    expect(onExpandedChange).not.toHaveBeenCalled();
  });

  it("surfaces a degraded runtime and its recovery guidance", async () => {
    vi.mocked(dshService.getDshSettings).mockResolvedValue({
      enabled: true,
      portRange: [3080, 3179],
      startTimeoutSec: 60,
      pinnedVersion: "0.1.0-rc.6",
    });
    vi.mocked(dshService.getDshPreflight).mockResolvedValue({
      ready: true,
      nodePath: "/opt/homebrew/bin/node",
      nodeVersion: "v24.19.0",
      npmPath: "/opt/homebrew/bin/npm",
      installedVersion: "0.1.0-rc.6",
      pinnedVersion: "0.1.0-rc.6",
      installPath: "/tmp/dsh",
      issues: [],
    });
    vi.mocked(dshService.getDshStatus).mockResolvedValue({
      state: "degraded",
      lastError: "DSH 进程仍在运行，但 HTTP 健康检查连续 3 次失败。",
      pinnedVersion: "0.1.0-rc.6",
    });

    render(
      <ul>
        <DshSettingsPanel
          expanded
          defaultWorkspaceDir="/Users/qian/work/demo"
          onExpandedChange={vi.fn()}
        />
      </ul>,
    );

    await waitFor(() => expect(screen.getByText("运行异常 · 展开查看详情")).toBeTruthy());
    expect(
      screen.getByText(
        (_, node) =>
          node?.tagName === "P" &&
          node.textContent?.includes("运行状态：服务异常") === true,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/健康检查连续 3 次失败/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "停止实例" })).toBeTruthy();
  });

  it("serializes stop requests and projects the stopped state", async () => {
    vi.mocked(dshService.getDshSettings).mockResolvedValue({
      enabled: true,
      portRange: [3080, 3179],
      startTimeoutSec: 60,
      pinnedVersion: "0.1.0-rc.6",
    });
    vi.mocked(dshService.getDshPreflight).mockResolvedValue({
      ready: true,
      nodePath: "/opt/homebrew/bin/node",
      nodeVersion: "v24.19.0",
      npmPath: "/opt/homebrew/bin/npm",
      installedVersion: "0.1.0-rc.6",
      pinnedVersion: "0.1.0-rc.6",
      installPath: "/tmp/dsh",
      issues: [],
    });
    vi.mocked(dshService.getDshStatus).mockResolvedValue({
      state: "running",
      workspaceDir: "/Users/qian/work/demo",
      pinnedVersion: "0.1.0-rc.6",
    });
    let resolveStop!: (status: dshService.DshStatus) => void;
    vi.mocked(dshService.stopDsh).mockReturnValue(
      new Promise((resolve) => {
        resolveStop = resolve;
      }),
    );

    render(
      <ul>
        <DshSettingsPanel
          expanded
          defaultWorkspaceDir="/Users/qian/work/demo"
          onExpandedChange={vi.fn()}
        />
      </ul>,
    );

    const stop = await screen.findByRole("button", { name: "停止实例" });
    fireEvent.click(stop);
    expect(dshService.stopDsh).toHaveBeenCalledOnce();
    expect((stop as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "停止中" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新安装固定版本" })).toBeTruthy();
    fireEvent.click(stop);
    expect(dshService.stopDsh).toHaveBeenCalledOnce();

    await act(async () => {
      resolveStop({ state: "stopped", pinnedVersion: "0.1.0-rc.6" });
    });

    await waitFor(() => expect(screen.getByText("已启用 · 随 KickSide 启动")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "停止实例" })).toBeNull();
    expect(screen.getByRole("button", { name: "启动实例" })).toBeTruthy();
  });

  it("starts an enabled stopped runtime in the effective default workspace", async () => {
    vi.mocked(dshService.getDshSettings).mockResolvedValue({
      enabled: true,
      portRange: [3080, 3179],
      startTimeoutSec: 60,
      pinnedVersion: "0.1.0-rc.6",
    });
    vi.mocked(dshService.getDshPreflight).mockResolvedValue({
      ready: true,
      nodePath: "/opt/homebrew/bin/node",
      nodeVersion: "v24.19.0",
      npmPath: "/opt/homebrew/bin/npm",
      installedVersion: "0.1.0-rc.6",
      pinnedVersion: "0.1.0-rc.6",
      installPath: "/tmp/dsh",
      issues: [],
    });
    vi.mocked(dshService.getDshStatus).mockResolvedValue({
      state: "stopped",
      pinnedVersion: "0.1.0-rc.6",
    });
    let resolveStart!: (status: dshService.DshStatus) => void;
    vi.mocked(dshService.startDsh).mockReturnValue(
      new Promise((resolve) => {
        resolveStart = resolve;
      }),
    );

    render(
      <ul>
        <DshSettingsPanel
          expanded
          defaultWorkspaceDir=" /Users/qian/work/demo "
          onExpandedChange={vi.fn()}
        />
      </ul>,
    );

    const start = await screen.findByRole("button", { name: "启动实例" });
    fireEvent.click(start);
    expect(dshService.startDsh).toHaveBeenCalledOnce();
    expect(dshService.startDsh).toHaveBeenCalledWith("/Users/qian/work/demo");
    expect(screen.getByRole("button", { name: "启动中" })).toBeTruthy();
    fireEvent.click(start);
    expect(dshService.startDsh).toHaveBeenCalledOnce();

    await act(async () => {
      resolveStart({
        state: "running",
        workspaceDir: "/Users/qian/work/demo",
        port: 3080,
        url: "http://127.0.0.1:3080",
        pinnedVersion: "0.1.0-rc.6",
      });
    });

    await waitFor(() => expect(screen.getByText("运行中 · demo")).toBeTruthy());
    expect(screen.getByRole("button", { name: "停止实例" })).toBeTruthy();
  });

  it("refreshes enabled runtime state while the control center remains open", async () => {
    vi.useFakeTimers();
    vi.mocked(dshService.getDshSettings).mockResolvedValue({
      enabled: true,
      portRange: [3080, 3179],
      startTimeoutSec: 60,
      pinnedVersion: "0.1.0-rc.6",
    });
    vi.mocked(dshService.getDshPreflight).mockResolvedValue({
      ready: true,
      nodePath: "/opt/homebrew/bin/node",
      nodeVersion: "v24.19.0",
      npmPath: "/opt/homebrew/bin/npm",
      installedVersion: "0.1.0-rc.6",
      pinnedVersion: "0.1.0-rc.6",
      installPath: "/tmp/dsh",
      issues: [],
    });
    vi.mocked(dshService.getDshStatus)
      .mockResolvedValueOnce({
        state: "starting",
        pinnedVersion: "0.1.0-rc.6",
      })
      .mockResolvedValue({
        state: "running",
        workspaceDir: "/Users/qian/work/demo",
        pinnedVersion: "0.1.0-rc.6",
      });

    render(<ul><DshSettingsPanel expanded={false} onExpandedChange={vi.fn()} /></ul>);
    await act(async () => Promise.resolve());
    await act(async () => Promise.resolve());
    expect(screen.getByText("正在加载默认工作区")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(screen.getByText("运行中 · demo")).toBeTruthy();
    expect(dshService.getDshStatus).toHaveBeenCalledTimes(2);
  });
});
