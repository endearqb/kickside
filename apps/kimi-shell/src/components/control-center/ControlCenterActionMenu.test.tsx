// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlCenterActionMenu } from "./ControlCenterActionMenu";

afterEach(cleanup);

describe("ControlCenterActionMenu", () => {
  it("dismisses on outside pointer and Escape without leaking Escape", () => {
    render(
      <ControlCenterActionMenu
        label="更多操作"
        items={[{ label: "打开目录", onSelect: vi.fn() }]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "更多操作" });

    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);
    const item = screen.getByRole("menuitem", { name: "打开目录" });
    item.focus();
    const leakedEscape = vi.fn();
    window.addEventListener("keydown", leakedEscape);
    fireEvent.keyDown(item, { key: "Escape" });
    expect(leakedEscape).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
    window.removeEventListener("keydown", leakedEscape);
  });

  it("moves through enabled items with arrow keys and restores focus after selection", () => {
    const onSelect = vi.fn();
    render(
      <ControlCenterActionMenu
        label="更多操作"
        items={[
          { label: "禁用项", disabled: true, onSelect: vi.fn() },
          { label: "打开目录", onSelect },
          { label: "复制路径", onSelect: vi.fn() },
        ]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "更多操作" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const first = screen.getByRole("menuitem", { name: "打开目录" });
    const last = screen.getByRole("menuitem", { name: "复制路径" });

    first.focus();
    fireEvent.keyDown(first, { key: "End" });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: "ArrowDown" });
    expect(document.activeElement).toBe(first);

    fireEvent.click(first);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
