// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DshControllerModel } from "@/app/useDshController";
import * as dshService from "@/services/dshService";
import { DshSettingsPanel } from "./DshSettingsPanel";

vi.mock("@/services/dshService", () => ({
  getDshLogTail: vi.fn(async () => []),
}));

function readyPreflight(): dshService.DshPreflight {
  return {
    ready: true,
    runtimeReady: true,
    installReady: true,
    nodeSupported: true,
    npmAvailable: true,
    installValid: true,
    nodePath: "/opt/homebrew/bin/node",
    nodeVersion: "v24.19.0",
    installNodePath: "/opt/homebrew/bin/node",
    installNodeVersion: "v24.19.0",
    npmPath: "/opt/homebrew/bin/npm",
    installedVersion: "0.1.0-rc.6",
    pinnedVersion: "0.1.0-rc.6",
    installPath: "/tmp/dsh",
    issues: [],
  };
}

function createDshController(
  overrides: Partial<DshControllerModel> = {},
): DshControllerModel {
  return {
    settings: null,
    preflight: null,
    status: null,
    error: null,
    busy: false,
    busyAction: null,
    refresh: vi.fn(async () => null),
    toggle: vi.fn(async () => null),
    install: vi.fn(async () => null),
    start: vi.fn(async () => null),
    stop: vi.fn(async () => null),
    ...overrides,
  };
}

const enabledSettings: dshService.DshSettings = {
  enabled: true,
  portRange: [3080, 3179],
  startTimeoutSec: 60,
  pinnedVersion: "0.1.0-rc.6",
};

const disabledSettings: dshService.DshSettings = {
  ...enabledSettings,
  enabled: false,
};

describe("DshSettingsPanel", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders shared controller state as a branded update-list row", () => {
    const dsh = createDshController({
      settings: enabledSettings,
      preflight: readyPreflight(),
      status: {
        state: "running",
        workspaceDir: "/Users/qian/work/demo",
        pinnedVersion: "0.1.0-rc.6",
      },
    });
    const onExpandedChange = vi.fn();
    const { container, rerender } = render(
      <ul>
        <DshSettingsPanel
          dsh={dsh}
          expanded={false}
          onExpandedChange={onExpandedChange}
        />
      </ul>,
    );

    expect(screen.getByText("运行中 · demo")).toBeTruthy();
    expect(container.querySelector("li.cc-settings-bar")).toBeTruthy();
    expect(container.querySelector('[data-settings-row="dsh"]')).toBeTruthy();
    expect(container.querySelector('[data-backend-brand="dsh"]')).toBeTruthy();
    expect(
      (screen.getByRole("checkbox", { name: "启用 DeepSeek Harness" }) as HTMLInputElement)
        .checked,
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /DeepSeek Harness/ }));
    expect(onExpandedChange).toHaveBeenCalledWith(true);
    rerender(
      <ul>
        <DshSettingsPanel
          dsh={dsh}
          expanded
          onExpandedChange={onExpandedChange}
        />
      </ul>,
    );
    expect(screen.getByText(/启用后随应用启动默认工作区/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新安装固定版本" })).toBeTruthy();
    expect(dsh.refresh).toHaveBeenCalledWith({ preflight: "cached" });
  });

  it("delegates the enable switch without changing disclosure state", async () => {
    const toggle = vi.fn(async () => ({ ...enabledSettings }));
    const dsh = createDshController({
      settings: disabledSettings,
      preflight: readyPreflight(),
      status: { state: "stopped", pinnedVersion: "0.1.0-rc.6" },
      toggle,
    });
    const onExpandedChange = vi.fn();
    render(
      <ul>
        <DshSettingsPanel
          dsh={dsh}
          expanded={false}
          onExpandedChange={onExpandedChange}
        />
      </ul>,
    );

    fireEvent.click(await screen.findByRole("checkbox", { name: "启用 DeepSeek Harness" }));

    await waitFor(() => expect(toggle).toHaveBeenCalledWith(true));
    expect(onExpandedChange).not.toHaveBeenCalled();
  });

  it("requests preflight through the shared controller only when expanded", () => {
    const refresh = vi.fn(async () => null);
    const dsh = createDshController({
      settings: disabledSettings,
      refresh,
    });

    render(
      <ul>
        <DshSettingsPanel dsh={dsh} expanded onExpandedChange={vi.fn()} />
      </ul>,
    );

    expect(refresh).toHaveBeenCalledWith({ preflight: "cached" });
    expect(dshService.getDshLogTail).not.toHaveBeenCalled();
  });

  it("surfaces a degraded runtime and its recovery guidance", () => {
    const dsh = createDshController({
      settings: enabledSettings,
      preflight: readyPreflight(),
      status: {
        state: "degraded",
        lastError: "DSH 进程仍在运行，但 HTTP 健康检查连续 3 次失败。",
        pinnedVersion: "0.1.0-rc.6",
      },
    });

    render(
      <ul>
        <DshSettingsPanel
          dsh={dsh}
          expanded
          defaultWorkspaceDir="/Users/qian/work/demo"
          onExpandedChange={vi.fn()}
        />
      </ul>,
    );

    expect(screen.getByText("运行异常 · 展开查看详情")).toBeTruthy();
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

  it("streams installation stages and output from the shared controller", async () => {
    let emit!: (event: dshService.DshInstallEvent) => void;
    let resolveInstall!: (report: dshService.DshPreflight) => void;
    const install = vi.fn(
      (onEvent?: (event: dshService.DshInstallEvent) => void) =>
        new Promise<dshService.DshPreflight>((resolve) => {
          emit = onEvent ?? (() => undefined);
          resolveInstall = resolve;
        }),
    );
    const dsh = createDshController({
      settings: disabledSettings,
      preflight: readyPreflight(),
      status: { state: "stopped", pinnedVersion: "0.1.0-rc.6" },
      install,
    });

    render(
      <ul>
        <DshSettingsPanel dsh={dsh} expanded onExpandedChange={vi.fn()} />
      </ul>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "重新安装固定版本" }));
    expect(screen.getByRole("status").textContent).toContain("正在检测 Node.js");

    act(() => {
      emit({
        type: "stage",
        stage: "install",
        message: "正在连接 npm registry 并安装固定版本",
      });
      emit({ type: "output", stream: "stdout", line: "added 120 packages" });
    });

    expect(screen.getByRole("status").textContent).toContain("正在连接 npm registry");
    expect(screen.getByRole("log").textContent).toContain("added 120 packages");

    await act(async () => {
      emit({ type: "completed", version: "0.1.0-rc.6" });
      resolveInstall(readyPreflight());
    });

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("安装完成"),
    );
    expect(dshService.getDshLogTail).not.toHaveBeenCalled();
  });

  it("projects stop and start actions through the shared controller", async () => {
    let resolveStop!: (status: dshService.DshStatus) => void;
    const dsh = createDshController({
      settings: enabledSettings,
      preflight: readyPreflight(),
      status: {
        state: "running",
        workspaceDir: "/Users/qian/work/demo",
        pinnedVersion: "0.1.0-rc.6",
      },
      stop: vi.fn(
        () =>
          new Promise<dshService.DshStatus>((resolve) => {
            resolveStop = resolve;
          }),
      ),
    });

    const { rerender } = render(
      <ul>
        <DshSettingsPanel
          dsh={dsh}
          expanded
          defaultWorkspaceDir="/Users/qian/work/demo"
          onExpandedChange={vi.fn()}
        />
      </ul>,
    );

    fireEvent.click(screen.getByRole("button", { name: "停止实例" }));
    expect(dsh.stop).toHaveBeenCalledOnce();

    dsh.busy = true;
    dsh.busyAction = "stop";
    rerender(
      <ul>
        <DshSettingsPanel
          dsh={dsh}
          expanded
          defaultWorkspaceDir="/Users/qian/work/demo"
          onExpandedChange={vi.fn()}
        />
      </ul>,
    );
    expect(
      (screen.getByRole("button", { name: "停止中" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await act(async () => {
      resolveStop({ state: "stopped", pinnedVersion: "0.1.0-rc.6" });
    });
    dsh.busy = false;
    dsh.busyAction = null;
    dsh.status = { state: "stopped", pinnedVersion: "0.1.0-rc.6" };
    rerender(
      <ul>
        <DshSettingsPanel
          dsh={dsh}
          expanded
          defaultWorkspaceDir="/Users/qian/work/demo"
          onExpandedChange={vi.fn()}
        />
      </ul>,
    );
    expect(screen.getByRole("button", { name: "启动实例" })).toBeTruthy();
  });
});
