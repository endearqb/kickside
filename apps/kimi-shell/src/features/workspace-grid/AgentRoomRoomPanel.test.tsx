// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listRooms: vi.fn(),
  createRoom: vi.fn(),
  updateRoom: vi.fn(),
  deleteRoom: vi.fn(),
}));

vi.mock("@/services/agentRoomService", () => ({
  listAgentRooms: mocks.listRooms,
  createAgentRoom: mocks.createRoom,
  updateAgentRoom: mocks.updateRoom,
  deleteAgentRoom: mocks.deleteRoom,
}));

import { AgentRoomRoomPanel } from "./AgentRoomRoomPanel";

describe("AgentRoomRoomPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listRooms.mockImplementation(async ({ archived }) => ({
      items: archived ? [archivedRoom] : [activeRoom],
      cursor: "",
    }));
    mocks.createRoom.mockImplementation(async (input) => room({ ...input, roomId: "room-new" }));
    mocks.updateRoom.mockImplementation(async (roomId, input) =>
      room({ ...(roomId === activeRoom.roomId ? activeRoom : archivedRoom), ...input, roomId }),
    );
    mocks.deleteRoom.mockResolvedValue({ status: "deleted" });
  });

  afterEach(cleanup);

  it("creates a Room with mode and bounded Shared Brief, then restores it as the pane selection", async () => {
    const onSelectRoom = vi.fn();
    render(<AgentRoomRoomPanel onSelectRoom={onSelectRoom} onChanged={vi.fn()} />);
    const form = await screen.findByRole("form", { name: "创建房间表单" });
    fireEvent.change(within(form).getByLabelText("标题"), { target: { value: "Review Room" } });
    fireEvent.change(within(form).getByLabelText("Mode"), { target: { value: "parallel" } });
    fireEvent.change(within(form).getByLabelText("Shared Brief"), { target: { value: "Review independently" } });
    fireEvent.click(within(form).getByRole("button", { name: "创建房间" }));

    await waitFor(() =>
      expect(mocks.createRoom).toHaveBeenCalledWith({
        title: "Review Room",
        description: "",
        sharedBrief: "Review independently",
        orchestrationMode: "parallel",
      }),
    );
    expect(onSelectRoom).toHaveBeenCalledWith("room-new");
  });

  it("edits, archives read-only, restores, and confirms that deletion keeps Sessions", async () => {
    const onSelectRoom = vi.fn();
    render(<AgentRoomRoomPanel selectedRoomId="room-active" onSelectRoom={onSelectRoom} onChanged={vi.fn()} />);
    const form = await screen.findByRole("form", { name: "编辑房间 Active Room" });
    fireEvent.change(within(form).getByLabelText("标题"), { target: { value: "Renamed Room" } });
    fireEvent.click(within(form).getByRole("button", { name: "保存房间" }));
    await waitFor(() => expect(mocks.updateRoom).toHaveBeenCalledWith("room-active", expect.objectContaining({ title: "Renamed Room" })));

    fireEvent.click(within(form).getByRole("button", { name: "归档房间" }));
    await waitFor(() => expect(mocks.updateRoom).toHaveBeenCalledWith("room-active", { archived: true }));
    expect((within(form).getByLabelText("标题") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(within(form).getByRole("button", { name: "恢复房间" }));
    await waitFor(() => expect(mocks.updateRoom).toHaveBeenCalledWith("room-active", { archived: false }));

    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    fireEvent.click(within(form).getByRole("button", { name: "删除房间" }));
    await waitFor(() => expect(mocks.deleteRoom).toHaveBeenCalledWith("room-active"));
    expect(confirm.mock.calls[0]?.[0]).toContain("Kimi Session 不会删除");
  });
});

const activeRoom = room({ roomId: "room-active", title: "Active Room" });
const archivedRoom = room({ roomId: "room-archived", title: "Archived Room", archived: true });

function room(overrides: Record<string, unknown> = {}) {
  return {
    roomId: "room-1",
    title: "Room",
    description: "",
    sharedBrief: "",
    orchestrationMode: "direct",
    archived: false,
    createdAt: "2026-07-19T00:00:00Z",
    updatedAt: "2026-07-19T00:00:00Z",
    ...overrides,
  };
}
