// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceEntryButton } from "./ControlCenterView";

afterEach(cleanup);

describe("WorkspaceEntryButton", () => {
  it("enters an already running workspace without restarting the backend", () => {
    const onEnter = vi.fn(async () => undefined);

    render(
      <WorkspaceEntryButton
        status={{ state: "running" }}
        onboarding={{ shouldShowOnboarding: true }}
        actionBusy={false}
        onEnter={onEnter}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "进入工作区" }));
    expect(onEnter).toHaveBeenCalledOnce();
  });

  it("stays hidden when onboarding is complete or the backend is not running", () => {
    const onEnter = vi.fn(async () => undefined);
    const { rerender } = render(
      <WorkspaceEntryButton
        status={{ state: "starting" }}
        onboarding={{ shouldShowOnboarding: true }}
        actionBusy={false}
        onEnter={onEnter}
      />,
    );
    expect(screen.queryByRole("button", { name: "进入工作区" })).toBeNull();

    rerender(
      <WorkspaceEntryButton
        status={{ state: "running" }}
        onboarding={{ shouldShowOnboarding: false }}
        actionBusy={false}
        onEnter={onEnter}
      />,
    );
    expect(screen.queryByRole("button", { name: "进入工作区" })).toBeNull();
  });
});
