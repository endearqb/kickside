import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, Plus, Search } from "lucide-react";
import type { AgentRoom } from "@/app/types";

export function AgentRoomRoomSwitcher({
  rooms,
  selectedRoomId,
  busy = false,
  onSelect,
  onCreate,
}: {
  rooms: AgentRoom[];
  selectedRoomId?: string;
  busy?: boolean;
  onSelect: (roomId: string) => void;
  onCreate: (title: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [createError, setCreateError] = useState("");
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const switcherRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = rooms.find((room) => room.roomId === selectedRoomId);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return rooms.filter((room) => !needle || `${room.title} ${room.description ?? ""}`.toLocaleLowerCase().includes(needle));
  }, [query, rooms]);
  const activeRooms = filtered.filter((room) => !room.archived);
  const archivedRooms = filtered.filter((room) => room.archived);
  const navigable = [...activeRooms, ...(archivedOpen ? archivedRooms : [])];

  useEffect(() => {
    if (!open) return;
    setActiveIndex(Math.max(0, navigable.findIndex((room) => room.roomId === selectedRoomId)));
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [open, selectedRoomId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!switcherRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  function close() {
    setOpen(false);
    setCreating(false);
    setCreateError("");
    setQuery("");
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function choose(roomId: string) {
    onSelect(roomId);
    close();
  }

  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (creating || !navigable.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((value) => (value + delta + navigable.length) % navigable.length);
    }
    if (event.key === "Enter") {
      event.preventDefault();
      choose(navigable[activeIndex]?.roomId);
    }
  }

  async function create() {
    const value = title.trim();
    if (!value || Array.from(value).length > 128 || busy) return;
    setCreateError("");
    try {
      await onCreate(value);
      setTitle("");
      close();
    } catch {
      setCreateError("未创建房间；请检查本地服务后重试。");
    }
  }

  return (
    <div ref={switcherRef} className="ar-room-switcher">
      <button
        ref={triggerRef}
        type="button"
        className="ar-room-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{selected?.title ?? "选择或创建房间"}</span>
        <ChevronDown size={14} aria-hidden />
      </button>
      {open ? (
        <div className="ar-room-popover" onKeyDown={handleKeys}>
          {creating ? (
            <form
              className="ar-room-create"
              onSubmit={(event) => {
                event.preventDefault();
                void create();
              }}
            >
              <label htmlFor="ar-new-room-title">房间名称</label>
              <input
                id="ar-new-room-title"
                autoFocus
                maxLength={128}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
              <div>
                <button type="button" className="ar-btn ar-btn-quiet" onClick={() => setCreating(false)}>取消</button>
                <button type="submit" className="ar-btn ar-btn-primary" disabled={!title.trim() || busy}>创建房间</button>
              </div>
              {createError ? <p className="ar-error" role="alert">{createError}</p> : null}
            </form>
          ) : (
            <>
              <label className="ar-room-search">
                <Search size={14} aria-hidden />
                <span className="sr-only">搜索房间</span>
                <input ref={searchRef} role="combobox" aria-expanded="true" aria-controls={`ar-active-rooms${archivedOpen ? " ar-archived-rooms" : ""}`} aria-activedescendant={navigable[activeIndex] ? `ar-room-${navigable[activeIndex].roomId}` : undefined} value={query} placeholder="搜索房间…" onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} />
              </label>
              <div className="ar-room-list">
                <div id="ar-active-rooms" role="listbox" aria-label="活动房间">
                  {activeRooms.map((room, index) => (
                    <RoomOption key={room.roomId} room={room} selected={room.roomId === selectedRoomId} active={index === activeIndex} onSelect={choose} />
                  ))}
                  {!activeRooms.length ? <p className="ar-list-empty">没有匹配的活动房间</p> : null}
                </div>
                {archivedRooms.length ? (
                  <>
                    <button type="button" className="ar-archived-toggle" aria-expanded={archivedOpen} onClick={() => setArchivedOpen((value) => !value)}>
                      已归档 · {archivedRooms.length}
                    </button>
                    {archivedOpen ? <div id="ar-archived-rooms" role="listbox" aria-label="已归档房间">{archivedRooms.map((room, index) => (
                      <RoomOption key={room.roomId} room={room} selected={room.roomId === selectedRoomId} active={activeRooms.length + index === activeIndex} onSelect={choose} />
                    ))}</div> : null}
                  </>
                ) : null}
              </div>
              <div className="ar-room-popover-footer">
                <button type="button" className="ar-btn ar-btn-quiet" onClick={() => setCreating(true)}><Plus size={14} aria-hidden />新建房间</button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function RoomOption({ room, selected, active, onSelect }: { room: AgentRoom; selected: boolean; active: boolean; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      id={`ar-room-${room.roomId}`}
      role="option"
      aria-selected={selected}
      className={`ar-room-option${active ? " is-active" : ""}`}
      onClick={() => onSelect(room.roomId)}
    >
      <span className={`ar-status-dot is-${room.archived ? "idle" : "healthy"}`} aria-hidden />
      <span>{room.title}</span>
      <small>{room.archived ? "只读" : "活动"}</small>
    </button>
  );
}
