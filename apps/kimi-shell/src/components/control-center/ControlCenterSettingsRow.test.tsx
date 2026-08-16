// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlCenterSettingsRow } from "./ControlCenterSettingsRow";

afterEach(cleanup);

describe("ControlCenterSettingsRow", () => {
  it("uses a native disclosure button and keeps the trailing action independent", () => {
    const onExpandedChange = vi.fn();
    const onAction = vi.fn();

    render(
      <ul>
        <ControlCenterSettingsRow
          id="kimi"
          title="KimiCode"
          summary="v0.36.0 · 已是最新版本"
          statusTone="success"
          expanded={false}
          onExpandedChange={onExpandedChange}
          action={<button onClick={onAction}>检查更新</button>}
        >
          <p>详情</p>
        </ControlCenterSettingsRow>
      </ul>,
    );

    const disclosure = screen.getByRole("button", { name: /KimiCode/ });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(disclosure.getAttribute("aria-controls")).toBe("cc-settings-detail-kimi");

    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onExpandedChange).not.toHaveBeenCalled();

    fireEvent.click(disclosure);
    expect(onExpandedChange).toHaveBeenCalledWith(true);
  });

  it("exposes expanded content through the controlled state", () => {
    render(
      <ul>
        <ControlCenterSettingsRow
          id="dsh"
          title="DeepSeek Harness"
          summary="运行中"
          statusTone="success"
          expanded
          onExpandedChange={vi.fn()}
        >
          <p>运行详情</p>
        </ControlCenterSettingsRow>
      </ul>,
    );

    expect(screen.getByText("运行详情")).toBeTruthy();
    expect(screen.getByRole("button", { name: /DeepSeek Harness/ }).getAttribute("aria-expanded"))
      .toBe("true");
  });
});
