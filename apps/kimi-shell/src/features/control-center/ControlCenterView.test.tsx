// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlCenterPreservedPage, WorkspaceEntryButton } from "./ControlCenterView";

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

describe("ControlCenterPreservedPage", () => {
  function StatefulPage() {
    const [count, setCount] = useState(0);
    return <button onClick={() => setCount((value) => value + 1)}>计数 {count}</button>;
  }

  it("keeps local page state while hidden during control-center navigation", () => {
    const { rerender } = render(
      <ControlCenterPreservedPage active>
        <StatefulPage />
      </ControlCenterPreservedPage>,
    );
    fireEvent.click(screen.getByRole("button", { name: "计数 0" }));

    rerender(
      <ControlCenterPreservedPage active={false}>
        <StatefulPage />
      </ControlCenterPreservedPage>,
    );
    rerender(
      <ControlCenterPreservedPage active>
        <StatefulPage />
      </ControlCenterPreservedPage>,
    );
    expect(screen.getByRole("button", { name: "计数 1" })).toBeTruthy();
  });
});
