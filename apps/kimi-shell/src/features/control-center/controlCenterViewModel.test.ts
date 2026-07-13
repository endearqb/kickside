import { describe, expect, it } from "vitest";
import {
  controlSections,
  formatBridgeConnectorStateLabel,
  getStartupFailureMessage,
  getKimiInstallPrerequisiteIssues,
  isAssistantSettingsSection,
  shouldShowStartupFailureDiagnostics,
} from "./controlCenterViewModel";
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

describe("assistant settings navigation", () => {
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
