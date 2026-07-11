import { describe, expect, it } from "vitest";
import type { InstalledSkill } from "@/app/types";
import {
  selectPreferredDiscoveryId,
  selectPreferredSkillId,
} from "./useSkillCenterController";

const skills = [
  { id: "skill-a" },
  { id: "skill-b" },
] as InstalledSkill[];

describe("selectPreferredSkillId", () => {
  it("does not select the first skill by default", () => {
    expect(selectPreferredSkillId(skills)).toBeNull();
  });

  it("selects only an explicit available skill", () => {
    expect(selectPreferredSkillId(skills, "skill-b")).toBe("skill-b");
    expect(selectPreferredSkillId(skills, "missing")).toBeNull();
  });
});

describe("selectPreferredDiscoveryId", () => {
  const records = [
    { discoveryId: "discovery-a" },
    { discoveryId: "discovery-b" },
  ];

  it("does not select the first discovered skill by default", () => {
    expect(selectPreferredDiscoveryId(records)).toBeNull();
  });

  it("selects only an explicit available discovered skill", () => {
    expect(selectPreferredDiscoveryId(records, "discovery-b")).toBe("discovery-b");
    expect(selectPreferredDiscoveryId(records, "missing")).toBeNull();
  });
});
