import { describe, expect, it } from "vitest";
import { buildSkillUninstallConfirmMessage } from "./shellControllerDefaults";

describe("shell controller defaults", () => {
  it("includes skill name and projection count in uninstall confirmation", () => {
    expect(buildSkillUninstallConfirmMessage("Demo Skill", 2)).toContain("Demo Skill");
    expect(buildSkillUninstallConfirmMessage("Demo Skill", 2)).toContain("投影数量：2");
  });
});
