// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentRoom } from "@/app/types";
import { AgentRoomRoomSwitcher } from "./AgentRoomRoomSwitcher";

afterEach(cleanup);

describe("AgentRoomRoomSwitcher", () => {
  it("supports Arrow, Enter, Escape, and returns focus to its trigger", async () => {
    const onSelect = vi.fn();
    render(<AgentRoomRoomSwitcher rooms={[room("one", "一号房间"), room("two", "二号房间")]} selectedRoomId="one" onSelect={onSelect} onCreate={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: /一号房间/ });
    fireEvent.click(trigger);
    const search = screen.getByRole("combobox", { name: "搜索房间" });
    await waitFor(() => expect(document.activeElement).toBe(search));
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("two");
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("combobox", { name: "搜索房间" }), { key: "Escape" });
    expect(screen.queryByRole("combobox", { name: "搜索房间" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

function room(roomId: string, title: string): AgentRoom {
  return { roomId, title, orchestrationMode: "direct", archived: false, createdAt: "", updatedAt: "" };
}
