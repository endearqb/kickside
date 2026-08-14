// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlCenterUnifiedRail, type UnifiedRailGroup } from "./ControlCenterUnifiedRail";

afterEach(cleanup);

function groups(): UnifiedRailGroup[] {
  return [
    {
      id: "pages",
      label: "页面",
      items: [
        { id: "settings", label: "KickSide 设置", active: true, onSelect: vi.fn() },
        { id: "skills", label: "Skill 中心", onSelect: vi.fn() },
      ],
    },
    {
      id: "workspaces",
      label: "工作区",
      collapsible: true,
      items: [{ id: "demo", label: "Demo Workspace", onSelect: vi.fn() }],
    },
  ];
}

describe("ControlCenterUnifiedRail", () => {
  it("uses one roving Tab stop and supports arrows, Home and End", () => {
    render(
      <ControlCenterUnifiedRail
        title="控制中心"
        groups={groups()}
        expandedGroups={new Set(["workspaces"])}
        onToggleGroup={vi.fn()}
      />,
    );

    const settings = screen.getByRole("button", { name: "KickSide 设置" });
    const skills = screen.getByRole("button", { name: "Skill 中心" });
    const workspaceGroup = screen.getByRole("button", { name: /工作区/ });
    const workspace = screen.getByRole("button", { name: "Demo Workspace" });
    const railButtons = [settings, skills, workspaceGroup, workspace];
    expect(railButtons.filter((button) => button.tabIndex === 0)).toEqual([settings]);

    settings.focus();
    fireEvent.keyDown(settings, { key: "ArrowDown" });
    expect(document.activeElement).toBe(skills);
    fireEvent.keyDown(skills, { key: "End" });
    expect(document.activeElement).toBe(workspace);
    fireEvent.keyDown(workspace, { key: "Home" });
    expect(document.activeElement).toBe(settings);
  });

  it("supports group navigation and typeahead", () => {
    const onToggleGroup = vi.fn();
    render(
      <ControlCenterUnifiedRail
        title="控制中心"
        groups={groups()}
        expandedGroups={new Set(["workspaces"])}
        onToggleGroup={onToggleGroup}
      />,
    );

    const settings = screen.getByRole("button", { name: "KickSide 设置" });
    const workspaceGroup = screen.getByRole("button", { name: /工作区/ });
    const workspace = screen.getByRole("button", { name: "Demo Workspace" });
    settings.focus();
    fireEvent.keyDown(settings, { key: "d" });
    expect(document.activeElement).toBe(workspace);
    fireEvent.keyDown(workspace, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(workspaceGroup);
    fireEvent.keyDown(workspaceGroup, { key: "ArrowLeft" });
    expect(onToggleGroup).toHaveBeenCalledWith("workspaces");
  });
});
