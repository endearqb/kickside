import { describe, expect, it } from "vitest";
import {
  controlSections,
  createExplorerContextMenuSteps,
  formatBridgeConnectorStateLabel,
  getStartupFailureMessage,
  getKimiDoctorSummary,
  getLegacySettingsCard,
  getKimiInstallPrerequisiteIssues,
  getKimiCodeUpdatePresentation,
  isAssistantSettingsSection,
  shouldShowStartupFailureDiagnostics,
} from "./controlCenterViewModel";
import { vi } from "vitest";
import type { AppStatus, DiagnosticsInfo, InstallProbeStatus } from "@/app/types";

const readyProbe: InstallProbeStatus = {
  wingetReady: true,
  gitReady: true,
  gitBashReady: true,
  kimiShellPath: "C:\\Program Files\\Git\\bin\\bash.exe",
  uvReady: false,
  python313Ready: false,
  kimiReady: false,
  nodeReady: true,
  coreReady: false,
};

describe("getKimiInstallPrerequisiteIssues", () => {
  it("requires explicit Node and Git Bash readiness", () => {
    expect(
      getKimiInstallPrerequisiteIssues({
        ...readyProbe,
        nodeReady: false,
        gitBashReady: false,
      }),
    ).toEqual(["需要 Node.js 22.19+", "需要 Git for Windows / Git Bash"]);
  });

  it("returns no issues when npm install prerequisites are ready", () => {
    expect(getKimiInstallPrerequisiteIssues(readyProbe)).toEqual([]);
  });
});

describe("getKimiCodeUpdatePresentation", () => {
  const info = {
    currentVersion: "0.29.2",
    latestVersion: "0.30.0",
    available: true,
  };

  it("matches the app updater status language without blocking manual fallback", () => {
    expect(getKimiCodeUpdatePresentation("available", info)).toMatchObject({
      barLabel: "v0.30.0 可更新",
      primaryLabel: "升级到 v0.30.0",
      tone: "warning",
      disabled: false,
    });
    expect(
      getKimiCodeUpdatePresentation("up_to_date", {
        ...info,
        currentVersion: "0.30.0",
        available: false,
      }),
    ).toMatchObject({
      barLabel: "v0.30.0 · 已是最新版本",
      tone: "success",
      disabled: true,
    });
    expect(getKimiCodeUpdatePresentation("error", null)).toMatchObject({
      barLabel: "更新检测失败",
      tone: "danger",
      disabled: false,
    });
  });
});

describe("assistant settings navigation", () => {
  it("does not construct the Explorer step on unsupported platforms", () => {
    const createStep = vi.fn(() => ({ id: "context_menu" }));

    expect(createExplorerContextMenuSteps(false, createStep)).toEqual([]);
    expect(createStep).not.toHaveBeenCalled();
    expect(createExplorerContextMenuSteps(true, createStep)).toEqual([
      { id: "context_menu" },
    ]);
  });

  it("recognizes every section that renders assistant settings", () => {
    expect((["overview", "onboarding", "runtime_center"] as const).map(isAssistantSettingsSection)).toEqual([
      true,
      true,
      true,
    ]);
    expect((["workspace_hub", "schedule", "skill_center"] as const).map(isAssistantSettingsSection)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("keeps external IM inside assistant settings", () => {
    expect(controlSections.map((section) => section.id)).toEqual([
      "onboarding",
      "skill_center",
      "workspace_hub",
      "schedule",
    ]);
  });

  it("uses the design-system status vocabulary for connectors", () => {
    expect(formatBridgeConnectorStateLabel("ready")).toBe("运行中");
    expect(formatBridgeConnectorStateLabel("degraded")).toBe("错误");
    expect(formatBridgeConnectorStateLabel("idle")).toBe("已停止");
  });
});

describe("startup failure diagnostics", () => {
  it("shows crashed backends and selects an actionable message", () => {
    const status = { state: "crashed", message: "后端启动失败" } as AppStatus;
    const diagnostics = { state: "crashed", lastError: "诊断错误" } as DiagnosticsInfo;

    expect(shouldShowStartupFailureDiagnostics(status, diagnostics)).toBe(true);
    expect(getStartupFailureMessage(status, diagnostics)).toBe("后端启动失败");
  });
});

describe("Kimi Doctor summary", () => {
  const result = {
    succeeded: true,
    command: "kimi doctor",
    kimiPath: "kimi.cmd",
    stdout: "OK config.toml",
    stderr: "",
  };

  it("distinguishes not run, valid config, check failure, and backend failure", () => {
    expect(getKimiDoctorSummary(null).label).toBe("尚未运行");
    expect(getKimiDoctorSummary(result).label).toBe("配置文件有效");
    expect(getKimiDoctorSummary({ ...result, succeeded: false }).label).toBe("检查失败");
    expect(getKimiDoctorSummary(result, true).label).toBe("后端启动失败");
  });

  it("maps the legacy diagnostics route to the Doctor setting", () => {
    expect(getLegacySettingsCard("runtime_center")).toBe("doctor");
    expect(getLegacySettingsCard("onboarding")).toBeNull();
  });
});
