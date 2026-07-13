import { describe, expect, it } from "vitest";
import {
  buildSkillUninstallConfirmMessage,
  formatKimiCodeAccessSaveError,
  toKimiCodeAccessInput,
} from "./shellControllerDefaults";

describe("shell controller defaults", () => {
  it("includes skill name and projection count in uninstall confirmation", () => {
    expect(buildSkillUninstallConfirmMessage("Demo Skill", 2)).toContain("Demo Skill");
    expect(buildSkillUninstallConfirmMessage("Demo Skill", 2)).toContain("投影数量：2");
  });

  it("carries config revision and turns conflicts into an actionable message", () => {
    const input = toKimiCodeAccessInput({
      kimiCodeHome: "C:/kimi",
      configPath: "C:/kimi/config.toml",
      configExists: true,
      configFingerprint: "content:1234",
      provider: { id: "kimi", type: "kimi", apiKeyConfigured: false },
      model: { id: "model", provider: "kimi", model: "model", maxContextSize: 1, exists: true },
      services: {
        search: { key: "search", apiKeyConfigured: false, usesProviderApiKey: false },
        fetch: { key: "fetch", apiKeyConfigured: false, usesProviderApiKey: false },
      },
      runtimeLimits: {},
      warnings: [],
    });

    expect(input.expectedConfigFingerprint).toBe("content:1234");
    expect(formatKimiCodeAccessSaveError("config_conflict: stale")).toContain("当前输入已保留");
  });
});
