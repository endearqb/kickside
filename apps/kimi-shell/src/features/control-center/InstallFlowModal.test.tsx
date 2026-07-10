// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InstallProbeStatus, InstallSessionSnapshot } from "@/app/types";
import { InstallFlowTaskContent } from "./InstallFlowModal";

const readyProbe: InstallProbeStatus = {
  wingetReady: true,
  gitReady: true,
  gitBashReady: true,
  kimiShellPath: "C:\\Program Files\\Git\\bin\\bash.exe",
  uvReady: true,
  python313Ready: true,
  kimiReady: true,
  nodeReady: true,
  coreReady: true,
};

const idleSession: InstallSessionSnapshot = {
  status: "idle",
  stage: "idle",
  logsTruncated: false,
  logs: [],
};

function createProps(): ComponentProps<typeof InstallFlowTaskContent> {
  return {
    session: idleSession,
    probe: readyProbe,
    probeBusy: false,
    probeMessage: "",
    backendState: "running",
    installSource: "official",
    installSettings: {
      preferredSource: "official",
      mirrorPreset: "mixed",
      customMirrorConfig: {
        gitReleasePages: [],
        uvReleasePages: [],
        pythonInstallerUrls: [],
        pypiIndexUrls: [],
      },
    },
    installSettingsBusy: false,
    installMirrorHealthReport: null,
    installMirrorHealthBusy: false,
    powershellPreflight: null,
    kimiPathInput: "",
    detectedKimiPath: "C:\\Users\\endea\\AppData\\Local\\pnpm\\kimi.CMD",
    onRefreshPowerShellPreflight: vi.fn(async () => undefined),
    onRefreshMirrorHealth: vi.fn(async () => undefined),
    onSourceChange: vi.fn(),
    onSaveInstallSettings: vi.fn(async () => undefined),
    onStartTask: vi.fn(async () => undefined),
    onRestartBackend: vi.fn(async () => undefined),
    onPickKimiPath: vi.fn(async () => undefined),
    onSavePathAndRetry: vi.fn(async () => undefined),
    restartBusy: false,
  };
}

describe("InstallFlowTaskContent", () => {
  afterEach(() => cleanup());

  it("shows only the compact ready-state requirements", () => {
    const { container } = render(<InstallFlowTaskContent {...createProps()} />);

    expect(container.querySelector("dl")).toBeTruthy();
    expect(screen.getByText("Kimi Code")).toBeTruthy();
    expect(screen.getByText("Node.js")).toBeTruthy();
    expect(screen.getByText("Git Bash")).toBeTruthy();
    expect(screen.getByText("C:\\Users\\endea\\AppData\\Local\\pnpm\\kimi.CMD")).toBeTruthy();
    expect(screen.queryByText("安装 / 管理 Kimi Code")).toBeNull();
    expect(screen.queryByText("主操作区")).toBeNull();
    expect(screen.queryByText("内置终端")).toBeNull();
    expect(screen.queryByText("复制当前步骤")).toBeNull();
    expect(screen.queryByRole("button", { name: "安装 Git" })).toBeNull();
    expect(screen.queryByRole("button", { name: "安装 Node.js" })).toBeNull();
    expect(screen.getByRole("button", { name: "更多选项" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("announces detection and exposes only missing dependency repairs", () => {
    const props = createProps();
    const { rerender } = render(
      <InstallFlowTaskContent {...props} probe={null} probeBusy />,
    );

    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
    expect(screen.getByText("正在检测安装环境…")).toBeTruthy();

    const missingProbe = {
      ...readyProbe,
      gitBashReady: false,
      nodeReady: false,
      coreReady: false,
    };
    rerender(
      <InstallFlowTaskContent {...props} probe={missingProbe} probeBusy={false} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "安装 Git" }));
    fireEvent.click(screen.getByRole("button", { name: "安装 Node.js" }));
    expect(props.onStartTask).toHaveBeenNthCalledWith(1, "install_git");
    expect(props.onStartTask).toHaveBeenNthCalledWith(2, "install_nodejs");
  });

  it("shows running progress and disables conflicting advanced actions", () => {
    const props = createProps();
    render(
      <InstallFlowTaskContent
        {...props}
        session={{
          ...idleSession,
          status: "running",
          stage: "execute_step",
          taskId: "upgrade_kimi",
          currentStepTitle: "升级 Kimi Code",
        }}
      />,
    );

    expect(screen.getByRole("status").textContent).toContain("执行中 · 升级 Kimi Code");
    fireEvent.click(screen.getByRole("button", { name: "更多选项" }));
    expect((screen.getByRole("button", { name: "官方源" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "重新预检" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "选择路径" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "卸载 Kimi Code" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("exposes uv and Python repair tasks only in advanced options", () => {
    const props = createProps();
    const missingLegacyProbe = { ...readyProbe, uvReady: false, python313Ready: false };
    const { rerender } = render(
      <InstallFlowTaskContent {...props} probe={missingLegacyProbe} />,
    );

    expect(screen.queryByRole("button", { name: "安装 uv" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "更多选项" }));
    fireEvent.click(screen.getByRole("button", { name: "安装 uv" }));
    expect(props.onStartTask).toHaveBeenCalledWith("install_uv");
    expect((screen.getByRole("button", { name: "安装 Python 3.13" }) as HTMLButtonElement).disabled).toBe(true);

    rerender(<InstallFlowTaskContent {...props} probe={{ ...missingLegacyProbe, uvReady: true }} />);
    fireEvent.click(screen.getByRole("button", { name: "安装 Python 3.13" }));
    expect(props.onStartTask).toHaveBeenCalledWith("install_python313");
  });

  it.each([
    ["failed", { failureSummary: "升级失败" }, "升级失败"],
    ["fallback_required", { fallbackReason: "需要手动处理" }, "需要手动处理"],
  ] as const)("keeps %s errors visible", (status, detail, expected) => {
    render(
      <InstallFlowTaskContent
        {...createProps()}
        session={{ ...idleSession, status, stage: "done", ...detail }}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain(expected);
  });

  it("offers restart and keeps destructive work behind confirmation", () => {
    const props = createProps();
    render(
      <InstallFlowTaskContent
        {...props}
        backendState="stopped"
        session={{
          ...idleSession,
          status: "succeeded",
          stage: "done",
          taskId: "upgrade_kimi",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "重启后端" }));
    expect(props.onRestartBackend).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "更多选项" }));
    expect(screen.getByRole("region", { name: "Kimi Code 安装高级选项" })).toBeTruthy();
    expect(screen.getByText("安装来源")).toBeTruthy();
    expect(screen.getByText("PowerShell 预检")).toBeTruthy();
    expect(screen.getByText("手动路径")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "卸载 Kimi Code" }));
    expect(screen.getByRole("dialog", { name: "卸载 Kimi Code" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认卸载" }));
    expect(props.onStartTask).toHaveBeenCalledWith("uninstall_kimi");
  });
});
