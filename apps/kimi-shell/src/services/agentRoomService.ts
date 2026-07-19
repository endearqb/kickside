import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type {
  AgentProfile,
  AgentProfileInput,
  AgentProfilePatchInput,
  AgentRoom,
  AgentRoomCapabilities,
  AgentRoomEventsPayload,
  AgentRoomMember,
  AgentRoomMemberInput,
  AgentRoomMemberPatchInput,
  AgentRoomTimeline,
  AgentRoomMutationResult,
  AgentRoomInput,
  AgentRoomPatchInput,
  AgentRoomObservationPinResult,
  AgentRoomMessage,
  AgentRoomPumpStatus,
  AgentRun,
  AgentRunRetryInput,
	AgentConnectorBinding,
	AgentConnectorBindingInput,
	WorkflowDefinition,
	BridgeApprovalRecord,
	BridgeStatus,
  BridgeApprovalResolveInput,
  PaneSessionObservation,
  SessionObservation,
  WorkspaceSessionBridgePayload,
} from "@/app/types";

export const AGENT_ROOM_EVENTS_EVENT = "agent-room-events";
export const AGENT_ROOM_PUMP_STATUS_EVENT = "agent-room-pump-status";

export interface AgentRoomCreateInput {
  title: string;
  description?: string;
  sharedBrief?: string;
  orchestrationMode: string;
}

export interface AgentRoomPostMessageInput {
  content: string;
  targetMemberIds?: string[];
  mode?: string;
  queuePolicy?: string;
  replyToMessageId?: string;
  attachments?: unknown;
  metadata?: unknown;
  sharedRunIds?: string[];
  workflowDefinition?: WorkflowDefinition;
}

export function resolveAgentRoomWorkflow(roomId: string, messageId: string, decision: "continue" | "stop") {
  return invoke<AgentRoomDispatchResult>("agent_room_resolve_workflow", { roomId, messageId, decision });
}

export function listAgentConnectorBindings() {
  return invoke<AgentRoomList<AgentConnectorBinding>>("agent_room_list_connector_bindings");
}

export function putAgentConnectorBinding(connectorId: string, input: AgentConnectorBindingInput) {
  return invoke<AgentConnectorBinding>("agent_room_put_connector_binding", { connectorId, input });
}

export function deleteAgentConnectorBinding(connectorId: string) {
  return invoke<AgentRoomMutationResult>("agent_room_delete_connector_binding", { connectorId });
}

export interface AgentRoomDispatchResult {
  message: AgentRoomMessage;
  runs: AgentRun[];
  failures: unknown[];
}

export interface AgentRoomDetail {
  room: AgentRoom;
  members: AgentRoomMember[];
}

export interface AgentRoomPage<T> {
  items: T[];
  cursor: string;
}

export interface AgentRoomList<T> {
  items: T[];
}

export interface AgentRoomListOptions {
  archived?: boolean;
  limit?: number;
  cursor?: string;
}

export interface AgentRoomObservationPage {
  items: SessionObservation[];
  pinnedSessionIds: string[];
  observerRunning: boolean;
}

export interface PaneSessionSyncInput {
  generation: number;
  panes: PaneSessionObservation[];
}

export interface PaneSessionSyncResult {
  acceptedGeneration: number;
  observedSessionIds: string[];
}

export function listAgentRoomAgents() {
  return invoke<AgentRoomList<AgentProfile>>("agent_room_list_agents");
}

export function createAgentRoomAgent(input: AgentProfileInput) {
  return invoke<AgentProfile>("agent_room_create_agent", { input });
}

export function updateAgentRoomAgent(agentId: string, input: AgentProfilePatchInput) {
  return invoke<AgentProfile>("agent_room_update_agent", { agentId, input });
}

export function deleteAgentRoomAgent(agentId: string) {
  return invoke<AgentRoomMutationResult>("agent_room_delete_agent", { agentId });
}

export function listAgentRooms(options: AgentRoomListOptions = {}) {
  return invoke<AgentRoomPage<AgentRoom>>("agent_room_list_rooms", {
    archived: options.archived,
    limit: options.limit,
    cursor: options.cursor,
  });
}

export function getAgentRoom(roomId: string) {
  return invoke<AgentRoomDetail>("agent_room_get_room", { roomId });
}

export function createAgentRoom(input: AgentRoomInput) {
  return invoke<AgentRoom>("agent_room_create_room", { input });
}

export function updateAgentRoom(roomId: string, input: AgentRoomPatchInput) {
  return invoke<AgentRoom>("agent_room_update_room", { roomId, input });
}

export function deleteAgentRoom(roomId: string) {
  return invoke<AgentRoomMutationResult>("agent_room_delete_room", { roomId });
}

export function listAgentRoomMembers(roomId: string) {
  return invoke<AgentRoomList<AgentRoomMember>>("agent_room_list_members", { roomId });
}

export function addAgentRoomMember(roomId: string, input: AgentRoomMemberInput) {
  return invoke<AgentRoomMember>("agent_room_add_member", { roomId, input });
}

export function updateAgentRoomMember(
  roomId: string,
  memberId: string,
  input: AgentRoomMemberPatchInput,
) {
  return invoke<AgentRoomMember>("agent_room_update_member", { roomId, memberId, input });
}

export function deleteAgentRoomMember(roomId: string, memberId: string) {
  return invoke<AgentRoomMutationResult>("agent_room_delete_member", { roomId, memberId });
}

export function getAgentRoomTimeline(roomId: string, options: { afterSeq?: number; beforeSeq?: number; limit?: number } = {}) {
  return invoke<AgentRoomTimeline>("agent_room_get_timeline", {
    roomId,
    afterSeq: options.afterSeq,
    beforeSeq: options.beforeSeq,
    limit: options.limit,
  });
}

export function postAgentRoomMessage(roomId: string, input: AgentRoomPostMessageInput) {
  return invoke<AgentRoomDispatchResult>("agent_room_post_message", { roomId, input });
}

export function abortAgentRoomRun(runId: string) {
  return invoke<AgentRun>("agent_room_abort_run", { runId });
}

export function retryAgentRoomRun(runId: string, input: AgentRunRetryInput = {}) {
  return invoke<AgentRun>("agent_room_retry_run", { runId, input });
}

export function resolveAgentRoomApproval(input: BridgeApprovalResolveInput) {
  return invoke<void>("agent_room_resolve_approval", { input });
}

export async function listAgentRoomApprovals(status?: string) {
	const items = await invoke<BridgeApprovalRecord[]>("list_bridge_approvals", { status });
	return items.filter((item) => item.platform === "agent_room");
}

export function getAgentRoomDiagnostics() {
	return invoke<BridgeStatus>("get_bridge_status");
}

export function syncAgentRoomPaneSessions(input: PaneSessionSyncInput) {
  return invoke<PaneSessionSyncResult>("agent_room_sync_pane_sessions", { input });
}

export function getAgentRoomCapabilities() {
  return invoke<AgentRoomCapabilities>("agent_room_get_capabilities");
}

export function listAgentRoomObservations() {
  return invoke<AgentRoomObservationPage>("agent_room_list_observations");
}

export function setAgentRoomObservationPin(sessionId: string, pinned: boolean) {
  return invoke<AgentRoomObservationPinResult>("agent_room_set_observation_pin", {
    sessionId,
    pinned,
  });
}

export function openAgentRoomSession(
  sessionId: string,
  workDir: string | undefined,
  disposition: "focus_existing" | "new_pane",
) {
  return invoke<WorkspaceSessionBridgePayload>("agent_room_open_session", {
    sessionId,
    workDir,
    disposition,
  });
}

export async function subscribeAgentRoomEvents(
  onEvents: (payload: AgentRoomEventsPayload) => void,
  onPumpStatus: (payload: AgentRoomPumpStatus) => void,
) {
  const window = getCurrentWebviewWindow();
  const unlistenEvents = await window.listen<AgentRoomEventsPayload>(
    AGENT_ROOM_EVENTS_EVENT,
    ({ payload }) => onEvents(payload),
  );
  try {
    const unlistenStatus = await window.listen<AgentRoomPumpStatus>(
      AGENT_ROOM_PUMP_STATUS_EVENT,
      ({ payload }) => onPumpStatus(payload),
    );
    return () => {
      unlistenEvents();
      unlistenStatus();
    };
  } catch (error) {
    unlistenEvents();
    throw error;
  }
}
