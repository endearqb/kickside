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
    installedVersion: "0.1.1-rc.2",
    pinnedVersion: "0.1.1-rc.2",
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
    updateInfo: null,
    updateError: null,
    error: null,
    busy: false,
    busyAction: null,
    refresh: vi.fn(async () => null),
    toggle: vi.fn(async () => null),
    install: vi.fn(async () => null),
    checkUpdate: vi.fn(async () => null),
    update: vi.fn(async () => null),
    start: vi.fn(async () => null),
    stop: vi.fn(async () => null),
    ...overrides,
  };
}

const enabledSettings: dshService.DshSettings = {
  enabled: true,
  portRange: [3080, 3179],
  startTimeoutSec: 60,
  pinnedVersion: "0.1.1-rc.2",
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
        pinnedVersion: "0.1.1-rc.2",
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
    expect(screen.getByRole("button", { name: "重新安装官方最新版" })).toBeTruthy();
    expect(dsh.refresh).toHaveBeenCalledWith({ preflight: "cached" });
  });

  it("delegates the enable switch without changing disclosure state", async () => {
    const toggle = vi.fn(async () => ({ ...enabledSettings }));
    const dsh = createDshController({
      settings: disabledSettings,
      preflight: readyPreflight(),
      status: { state: "stopped", pinnedVersion: "0.1.1-rc.2" },
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

  it("shows a resolved official latest update and delegates one-click upgrade", async () => {
    const update = vi.fn(async () => readyPreflight());
    const dsh = createDshController({
      settings: enabledSettings,
      preflight: {
        ...readyPreflight(),
        installedVersion: "0.1.1-rc.2",
        installValid: true,
        runtimeReady: true,
      },
      status: { state: "stopped", pinnedVersion: "0.1.1-rc.2" },
      updateInfo: {
        state: "up_to_date",
        installedVersion: "0.1.1-rc.2",
        recommendedVersion: "0.1.1-rc.2",
        upstreamVersion: "0.1.1-rc.3",
        updateAvailable: false,
        officialVersion: "0.1.1-rc.3",
        officialState: "update_available",
        officialUpdateAvailable: true,
        installedSupported: true,
        compatible: true,
        checkedAtMs: 1,
      },
      update,
    });

    render(
      <ul>
        <DshSettingsPanel
          dsh={dsh}
          expanded
          onExpandedChange={vi.fn()}
          defaultWorkspaceDir="/tmp/workspace"
        />
      </ul>,
    );

    expect(screen.getByText(/0.1.1-rc.2 → 0.1.1-rc.3/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "启动实例" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "升级到 0.1.1-rc.3" }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
  });

  it("projects npm latest as the exact official target", () => {
    const dsh = createDshController({
      settings: enabledSettings,
      preflight: readyPreflight(),
      status: { state: "stopped", pinnedVersion: "0.1.1-rc.2" },
      updateInfo: {
        state: "up_to_date",
        installedVersion: "0.1.1-rc.2",
        recommendedVersion: "0.1.1-rc.2",
        upstreamVersion: "0.1.1-rc.2",
        updateAvailable: false,
        officialVersion: "0.1.1-rc.2",
        officialState: "up_to_date",
        officialUpdateAvailable: false,
        installedSupported: true,
        compatible: true,
        checkedAtMs: 1,
      },
    });

    render(
      <ul>
        <DshSettingsPanel dsh={dsh} expanded onExpandedChange={vi.fn()} />
      </ul>,
    );

    expect(screen.getByText("官方最新")).toBeTruthy();
    expect(screen.getByText("用户主动 · npm latest")).toBeTruthy();
    expect(screen.queryByText(/尚未通过 KickSide 兼容性验证/)).toBeNull();
    expect(screen.queryByRole("button", { name: /升级到/ })).toBeNull();
    expect(screen.getByRole("button", { name: "重新安装官方最新版" })).toBeTruthy();
  });

  it("repairs an unsupported installation through the official install path", async () => {
    const install = vi.fn(async () => readyPreflight());
    const dsh = createDshController({
      settings: enabledSettings,
      preflight: {
        ...readyPreflight(),
        installValid: false,
        runtimeReady: false,
        installedVersion: "not-semver",
      },
      status: { state: "stopped", pinnedVersion: "0.1.1-rc.2" },
      updateInfo: {
        state: "unsupported",
        installedVersion: "not-semver",
        recommendedVersion: "0.1.1-rc.2",
        upstreamVersion: "0.1.1-rc.3",
        updateAvailable: false,
        officialVersion: "0.1.1-rc.3",
        officialState: "unsupported",
        officialUpdateAvailable: false,
        installedSupported: false,
        compatible: false,
        checkedAtMs: 1,
      },
      install,
    });

    render(
      <ul>
        <DshSettingsPanel dsh={dsh} expanded onExpandedChange={vi.fn()} />
      </ul>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "恢复官方最新版 0.1.1-rc.3" }),
    );
    await waitFor(() => expect(install).toHaveBeenCalledOnce());
  });

  it("labels replacement of an ahead installation as restoring official latest", async () => {
    const install = vi.fn(async () => readyPreflight());
    const dsh = createDshController({
      settings: enabledSettings,
      preflight: {
        ...readyPreflight(),
        installedVersion: "0.1.1-rc.4",
      },
      status: { state: "stopped", pinnedVersion: "0.1.1-rc.2" },
      updateInfo: {
        state: "ahead",
        installedVersion: "0.1.1-rc.4",
        recommendedVersion: "0.1.1-rc.2",
        upstreamVersion: "0.1.1-rc.3",
        updateAvailable: false,
        officialVersion: "0.1.1-rc.3",
        officialState: "ahead",
        officialUpdateAvailable: false,
        installedSupported: true,
        compatible: true,
        checkedAtMs: 1,
      },
      install,
    });

    render(
      <ul>
        <DshSettingsPanel dsh={dsh} expanded onExpandedChange={vi.fn()} />
      </ul>,
    );

    expect(screen.getByText(/恢复操作会替换为官方最新版/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "恢复官方最新版 0.1.1-rc.3" }),
    );
    await waitFor(() => expect(install).toHaveBeenCalledOnce());
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
        pinnedVersion: "0.1.1-rc.2",
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

    expect(screen.getByText("错误 · 展开查看详情")).toBeTruthy();
    expect(
      screen.getByText(
        (_, node) =>
          node?.tagName === "P" &&
          node.textContent?.includes("运行状态：错误") === true,
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
      status: { state: "stopped", pinnedVersion: "0.1.1-rc.2" },
      install,
    });

    render(
      <ul>
        <DshSettingsPanel dsh={dsh} expanded onExpandedChange={vi.fn()} />
      </ul>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "重新安装官方最新版" }));
    expect(screen.getByRole("status").textContent).toContain("正在检查官方最新版本与安装环境");

    act(() => {
      emit({
        type: "stage",
        stage: "install",
        message: "正在连接 npm registry 并安装精确版本",
      });
      emit({ type: "output", stream: "stdout", line: "added 120 packages" });
    });

    expect(screen.getByRole("status").textContent).toContain("正在连接 npm registry");
    expect(screen.getByRole("log").textContent).toContain("added 120 packages");

    await act(async () => {
      emit({ type: "completed", version: "0.1.1-rc.2" });
      resolveInstall(readyPreflight());
    });

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("安装完成"),
    );
    expect(dshService.getDshLogTail).not.toHaveBeenCalled();
  });

  it("replaces in-progress copy with a terminal failure state", async () => {
    const install = vi.fn(async (onEvent?: (event: dshService.DshInstallEvent) => void) => {
      onEvent?.({
        type: "failed",
        code: "E-DSH-002",
        message: "npm registry 不可用",
      });
      return null;
    });
    const dsh = createDshController({
      settings: disabledSettings,
      preflight: readyPreflight(),
      status: { state: "stopped", pinnedVersion: "0.1.1-rc.2" },
      install,
    });

    render(
      <ul>
        <DshSettingsPanel dsh={dsh} expanded onExpandedChange={vi.fn()} />
      </ul>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "重新安装官方最新版" }));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("安装失败"),
    );
    expect(screen.getByRole("alert").textContent).toContain("npm registry 不可用");
  });

  it("projects stop and start actions through the shared controller", async () => {
    let resolveStop!: (status: dshService.DshStatus) => void;
    const dsh = createDshController({
      settings: enabledSettings,
      preflight: readyPreflight(),
      status: {
        state: "running",
        workspaceDir: "/Users/qian/work/demo",
        pinnedVersion: "0.1.1-rc.2",
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
      resolveStop({ state: "stopped", pinnedVersion: "0.1.1-rc.2" });
    });
    dsh.busy = false;
    dsh.busyAction = null;
    dsh.status = { state: "stopped", pinnedVersion: "0.1.1-rc.2" };
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
