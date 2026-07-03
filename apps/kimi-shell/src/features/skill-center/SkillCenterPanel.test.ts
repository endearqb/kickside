import { describe, expect, it } from "vitest";
import {
  getSkillDirectoryEmptyCopy,
  matchesSkillDirectorySource,
  shouldBackToSkillDirectory,
} from "./SkillCenterPanel";

describe("SkillCenterPanel helpers", () => {
  it("matches installed and discovered card sources independently", () => {
    expect(matchesSkillDirectorySource("all", { kind: "installed", sourceType: "git" })).toBe(true);
    expect(matchesSkillDirectorySource("git", { kind: "installed", sourceType: "git" })).toBe(true);
    expect(matchesSkillDirectorySource("bundled", { kind: "installed", sourceType: "git" })).toBe(false);
    expect(matchesSkillDirectorySource("discovered", { kind: "discovered" })).toBe(true);
    expect(matchesSkillDirectorySource("git", { kind: "discovered" })).toBe(false);
  });

  it("distinguishes empty sections from empty search results", () => {
    expect(getSkillDirectoryEmptyCopy(0).title).toBe("本分区为空");
    expect(getSkillDirectoryEmptyCopy(1).title).toBe("没有匹配结果");
  });

  it("only treats Escape in a detail view as back navigation", () => {
    expect(shouldBackToSkillDirectory("Escape", true)).toBe(true);
    expect(shouldBackToSkillDirectory("Escape", false)).toBe(false);
    expect(shouldBackToSkillDirectory("Enter", true)).toBe(false);
  });
});
