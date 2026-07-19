import { useEffect, useState, type FormEvent } from "react";
import type { AgentRoom, AgentRoomInput } from "@/app/types";
import {
  createAgentRoom,
  deleteAgentRoom,
  listAgentRooms,
  updateAgentRoom,
} from "@/services/agentRoomService";

interface AgentRoomRoomPanelProps {
  selectedRoomId?: string;
  onSelectRoom: (roomId: string) => void;
  onChanged: () => void;
}

interface RoomDraft {
  title: string;
  description: string;
  sharedBrief: string;
  orchestrationMode: string;
}

const EMPTY_DRAFT: RoomDraft = {
  title: "",
  description: "",
  sharedBrief: "",
  orchestrationMode: "direct",
};

export function AgentRoomRoomPanel({ selectedRoomId, onSelectRoom, onChanged }: AgentRoomRoomPanelProps) {
  const [rooms, setRooms] = useState<AgentRoom[]>([]);
  const [selectedId, setSelectedId] = useState(selectedRoomId ?? "new");
  const [draft, setDraft] = useState<RoomDraft>(EMPTY_DRAFT);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const selected = rooms.find((room) => room.roomId === selectedId);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      listAgentRooms({ archived: false, limit: 100 }),
      listAgentRooms({ archived: true, limit: 100 }),
    ])
      .then(([active, archived]) => {
        if (cancelled) return;
        const items = [...active.items, ...archived.items];
        setRooms(items);
        const initial = items.find((room) => room.roomId === selectedRoomId);
        if (initial) {
          setSelectedId(initial.roomId);
          setDraft(toDraft(initial));
        }
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRoomId]);

  function selectRoom(room: AgentRoom) {
    setSelectedId(room.roomId);
    setDraft(toDraft(room));
    setError("");
    onSelectRoom(room.roomId);
  }

  function startNew() {
    setSelectedId("new");
    setDraft(EMPTY_DRAFT);
    setError("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const validationError = validateRoomDraft(draft);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const input = toInput(draft);
      const saved = selected
        ? await updateAgentRoom(selected.roomId, input)
        : await createAgentRoom(input);
      replaceRoom(saved);
      setSelectedId(saved.roomId);
      setDraft(toDraft(saved));
      onSelectRoom(saved.roomId);
      onChanged();
    } catch (saveError) {
      setError(roomErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function setArchived(archived: boolean) {
    if (!selected) return;
    setError("");
    try {
      const saved = await updateAgentRoom(selected.roomId, { archived });
      replaceRoom(saved);
      setDraft(toDraft(saved));
      onChanged();
    } catch (archiveError) {
      setError(roomErrorMessage(archiveError));
    }
  }

  async function removeSelected() {
    if (!selected) return;
    if (!window.confirm("删除 Room 元数据？成员和 Timeline 会删除，但 Kimi Session 不会删除。")) return;
    setError("");
    try {
      await deleteAgentRoom(selected.roomId);
      const remaining = rooms.filter((room) => room.roomId !== selected.roomId);
      setRooms(remaining);
      const next = remaining.find((room) => !room.archived);
      if (next) {
        setSelectedId(next.roomId);
        setDraft(toDraft(next));
        onSelectRoom(next.roomId);
      } else {
        startNew();
        onSelectRoom("");
      }
      onChanged();
    } catch (deleteError) {
      setError(roomErrorMessage(deleteError));
    }
  }

  function replaceRoom(room: AgentRoom) {
    setRooms((current) => [room, ...current.filter((item) => item.roomId !== room.roomId)]);
  }

  if (state === "loading") return <p>正在读取房间。</p>;
  if (state === "error") return <p role="alert">房间列表暂时不可用。</p>;

  return (
    <div className="agent-room-management" aria-label="房间管理">
      <aside className="agent-room-object-list">
        <div>
          <strong>房间</strong>
          <button type="button" onClick={startNew}>创建房间</button>
        </div>
        <RoomList title="当前房间" rooms={rooms.filter((room) => !room.archived)} selectedId={selectedId} onSelect={selectRoom} />
        <RoomList title="已归档" rooms={rooms.filter((room) => room.archived)} selectedId={selectedId} onSelect={selectRoom} />
      </aside>

      <form className="agent-room-agent-form" aria-label={selected ? `编辑房间 ${selected.title}` : "创建房间表单"} onSubmit={(event) => void save(event)}>
        <div className="agent-room-form-heading">
          <h3>{selected ? selected.title : "创建房间"}</h3>
          <div>
            {selected?.archived ? <button type="button" onClick={() => void setArchived(false)}>恢复房间</button> : null}
            {selected && !selected.archived ? <button type="button" onClick={() => void setArchived(true)}>归档房间</button> : null}
            {selected ? <button type="button" className="is-danger" onClick={() => void removeSelected()}>删除房间</button> : null}
            {!selected?.archived ? <button type="submit" disabled={saving}>{saving ? "正在保存" : selected ? "保存房间" : "创建房间"}</button> : null}
          </div>
        </div>

        {selected?.archived ? <p className="agent-room-risk">已归档房间只读；恢复后才能修改或添加成员。</p> : null}
        <section>
          <h4>房间设置</h4>
          <label>标题<input disabled={selected?.archived} value={draft.title} maxLength={128} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
          <label>说明<input disabled={selected?.archived} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
          <label>
            Mode
            <select disabled={selected?.archived} value={draft.orchestrationMode} onChange={(event) => setDraft({ ...draft, orchestrationMode: event.target.value })}>
              <option value="direct">Direct</option>
              <option value="parallel">Parallel</option>
              <option value="workflow">Workflow</option>
            </select>
          </label>
          <label>Shared Brief<textarea disabled={selected?.archived} value={draft.sharedBrief} onChange={(event) => setDraft({ ...draft, sharedBrief: event.target.value })} /></label>
        </section>
        {error ? <p className="agent-room-action-error" role="alert">{error}</p> : null}
      </form>
    </div>
  );
}

function RoomList({ title, rooms, selectedId, onSelect }: { title: string; rooms: AgentRoom[]; selectedId: string; onSelect: (room: AgentRoom) => void }) {
  if (!rooms.length) return null;
  return (
    <section className="agent-room-object-section">
      <h4>{title}</h4>
      <ul>
        {rooms.map((room) => (
          <li key={room.roomId}>
            <button type="button" className={selectedId === room.roomId ? "is-selected" : ""} onClick={() => onSelect(room)}>
              <strong>{room.title}</strong>
              <span>{room.archived ? "已停止" : "运行中"}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function toDraft(room: AgentRoom): RoomDraft {
  return {
    title: room.title,
    description: room.description ?? "",
    sharedBrief: room.sharedBrief ?? "",
    orchestrationMode: room.orchestrationMode,
  };
}
function toInput(draft: RoomDraft): AgentRoomInput {
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    sharedBrief: draft.sharedBrief.trim(),
    orchestrationMode: draft.orchestrationMode,
  };
}
function validateRoomDraft(draft: RoomDraft) {
  const titleLength = Array.from(draft.title.trim()).length;
  if (titleLength < 1 || titleLength > 128) return "标题必须为 1–128 个字符。";
  if (new TextEncoder().encode(draft.sharedBrief.trim()).length > 64 * 1024) return "Shared Brief 不能超过 64 KiB。";
  return "";
}
function roomErrorMessage(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
  if (code === "room_archived") return "已归档房间只读，请先恢复房间。";
  if (code === "shared_brief_too_large") return "Shared Brief 不能超过 64 KiB。";
  if (code === "feature_disabled") return "Agent Room 功能未启用。";
  return "房间操作失败，请检查输入和本地服务状态。";
}
