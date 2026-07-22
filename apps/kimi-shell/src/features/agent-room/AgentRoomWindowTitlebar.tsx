import { Pin, PinOff, X } from "lucide-react";
import type { AgentRoom } from "@/app/types";
import { AgentRoomRoomSwitcher } from "./AgentRoomRoomSwitcher";

export function AgentRoomWindowTitlebar({
  rooms,
  selectedRoomId,
  health,
  alwaysOnTop,
  busy,
  onSelectRoom,
  onCreateRoom,
  onRetry,
  onToggleAlwaysOnTop,
  onHide,
}: {
  rooms: AgentRoom[];
  selectedRoomId?: string;
  health: "healthy" | "connecting" | "degraded" | "disabled";
  alwaysOnTop: boolean;
  busy?: boolean;
  onSelectRoom: (roomId: string) => void;
  onCreateRoom: (title: string) => Promise<void>;
  onRetry: () => void;
  onToggleAlwaysOnTop: () => void;
  onHide: () => void;
}) {
  return (
    <header className="ar-titlebar" data-tauri-drag-region>
      <span className="ar-titlebar-name">Agent Room</span>
      <AgentRoomRoomSwitcher rooms={rooms} selectedRoomId={selectedRoomId} busy={busy} onSelect={onSelectRoom} onCreate={onCreateRoom} />
      <span className={`ar-health is-${health}`} role="status">
        <span className={`ar-status-dot is-${health}`} aria-hidden />
        {healthLabel(health)}
        {health === "degraded" ? <button type="button" className="ar-health-retry" onClick={onRetry}>重试</button> : null}
      </span>
      <span className="ar-titlebar-spacer" data-tauri-drag-region />
      <button type="button" className="ar-icon-btn" aria-label={alwaysOnTop ? "取消窗口置顶" : "窗口置顶"} title={alwaysOnTop ? "取消窗口置顶" : "窗口置顶"} onClick={onToggleAlwaysOnTop}>
        {alwaysOnTop ? <PinOff size={14} /> : <Pin size={14} />}
      </button>
      <button type="button" className="ar-icon-btn" aria-label="隐藏 Agent Room" title="关闭并隐藏窗口" onClick={onHide}><X size={14} /></button>
    </header>
  );
}

function healthLabel(value: "healthy" | "connecting" | "degraded" | "disabled") {
  return ({ healthy: "观察正常", connecting: "正在连接", degraded: "观察降级", disabled: "未启用" } as const)[value];
}
