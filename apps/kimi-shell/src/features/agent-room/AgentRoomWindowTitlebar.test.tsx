// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRoomWindowTitlebar } from "./AgentRoomWindowTitlebar";

const windowApi = vi.hoisted(() => ({
  startDragging: vi.fn(),
  close: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowApi,
}));

const props = {
  rooms: [],
  health: "healthy" as const,
  alwaysOnTop: false,
  onSelectRoom: vi.fn(),
  onCreateRoom: vi.fn(async () => undefined),
  onRetry: vi.fn(),
  onToggleAlwaysOnTop: vi.fn(),
  onWindowError: vi.fn(),
};

describe("AgentRoomWindowTitlebar", () => {
  beforeEach(() => {
    windowApi.startDragging.mockReset().mockResolvedValue(undefined);
    windowApi.close.mockReset().mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("drags from non-interactive titlebar content and closes through the window lifecycle", async () => {
    const { container } = render(<AgentRoomWindowTitlebar {...props} />);

    fireEvent.mouseDown(screen.getByText("Agent Room"), { button: 0 });
    fireEvent.mouseDown(screen.getByRole("status"), { button: 0 });
    fireEvent.mouseDown(container.querySelector(".ar-titlebar-spacer")!, { button: 0 });
    fireEvent.mouseDown(screen.getByRole("button", { name: "窗口置顶" }), { button: 0 });
    fireEvent.click(screen.getByRole("button", { name: "隐藏 Agent Room" }));

    await waitFor(() => expect(windowApi.startDragging).toHaveBeenCalledTimes(3));
    expect(windowApi.close).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-tauri-drag-region]")).toBeNull();
  });

  it("reports native window failures", async () => {
    const onWindowError = vi.fn();
    windowApi.startDragging.mockRejectedValueOnce(new Error("drag failed"));
    windowApi.close.mockRejectedValueOnce(new Error("close failed"));
    render(<AgentRoomWindowTitlebar {...props} onWindowError={onWindowError} />);

    fireEvent.mouseDown(screen.getByText("Agent Room"), { button: 0 });
    fireEvent.click(screen.getByRole("button", { name: "隐藏 Agent Room" }));

    await waitFor(() => expect(onWindowError).toHaveBeenCalledTimes(2));
    expect(onWindowError).toHaveBeenCalledWith("无法拖动 Agent Room 窗口。");
    expect(onWindowError).toHaveBeenCalledWith("无法关闭 Agent Room 窗口。");
  });
});
