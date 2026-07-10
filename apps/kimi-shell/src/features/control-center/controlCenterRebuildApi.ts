import { invoke } from "@tauri-apps/api/core";
import type { SkillFileContent, SkillFileEntry } from "@/app/types";

export type AgentRuntime = "kimi-code" | "hermes" | "other";
export type WorkspaceSource = "harness" | "manual" | "grid_migration";

export interface WorkspaceRecord {
  id: string;
  name: string;
  cwd: string;
  harnessId?: string | null;
  harnessVersion?: string | null;
  agentRuntime: AgentRuntime;
  source: WorkspaceSource;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string | null;
}

export interface WorkspaceRegisterInput {
  name?: string | null;
  cwd: string;
  harnessId?: string | null;
  harnessVersion?: string | null;
  agentRuntime?: AgentRuntime;
  source?: WorkspaceSource;
  tags?: string[];
}

export interface HarnessVariable {
  key: string;
  label: string;
  type: "string" | "path";
  required: boolean;
  secret: boolean;
  placeholder?: string | null;
}

export interface HarnessManifest {
  schemaVersion: number;
  id: string;
  name: string;
  summary: string;
  agentRuntime: AgentRuntime;
  version: string;
  tags: string[];
  skills: Array<{ id: string; source: string }>;
  variables: HarnessVariable[];
  template: string;
  postCreate: {
    openWith?: string | null;
    notes?: string | null;
  };
}

export interface PlannedFile {
  relPath: string;
  isDir: boolean;
  preview?: string | null;
}

export interface HarnessDryRunResult {
  files: PlannedFile[];
  warnings: string[];
}

export interface CreatedWorkspace {
  workspace: WorkspaceRecord;
  fileCount: number;
}

export type AcpExecutionPermission = "auto" | "yolo";
export type ScheduleOutcome =
  | "planned"
  | "executing"
  | "executed"
  | "failed"
  | "skipped"
  | "blocked_by_permission"
  | "schedule_error";

export type ScheduleCadence =
  | { kind: "daily"; at: string }
  | { kind: "weekday"; at: string }
  | { kind: "cron"; expression: string };

export interface HeartbeatConfig {
  id: string;
  workspaceId: string;
  enabled: boolean;
  intervalMinutes: number;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  lastOutcome?: ScheduleOutcome | null;
  updatedAt: string;
}

export interface ScheduledTask {
  id: string;
  workspaceId: string;
  name: string;
  prompt: string;
  cadence: ScheduleCadence;
  enabled: boolean;
  executionPermission: AcpExecutionPermission;
  maxRunMinutes: number;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  lastOutcome?: ScheduleOutcome | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleStore {
  heartbeats: HeartbeatConfig[];
  tasks: ScheduledTask[];
}

export interface RunRecord {
  id: string;
  kind: string;
  workspaceId: string;
  taskId?: string | null;
  taskName: string;
  outcome: ScheduleOutcome;
  acpSessionId?: string | null;
  plan?: string | null;
  result?: string | null;
  error?: string | null;
  rawEventsPath?: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export async function listWorkspaces(): Promise<WorkspaceRecord[]> {
  return invoke<WorkspaceRecord[]>("workspace_list");
}

export async function registerWorkspace(input: WorkspaceRegisterInput): Promise<WorkspaceRecord> {
  return invoke<WorkspaceRecord>("workspace_register", { input });
}

export async function markWorkspaceOpened(id: string): Promise<WorkspaceRecord> {
  return invoke<WorkspaceRecord>("workspace_mark_opened", { id });
}

export async function listWorkspaceFileEntries(workspaceId: string): Promise<SkillFileEntry[]> {
  return invoke<SkillFileEntry[]>("workspace_list_file_entries", { workspaceId });
}

export async function readWorkspaceFile(
  workspaceId: string,
  relPath: string,
): Promise<SkillFileContent> {
  return invoke<SkillFileContent>("workspace_read_file", { workspaceId, relPath });
}

export async function listHarnesses(): Promise<HarnessManifest[]> {
  return invoke<HarnessManifest[]>("harness_list");
}

export async function dryRunHarness(
  harnessId: string,
  values: Record<string, string>,
): Promise<HarnessDryRunResult> {
  return invoke<HarnessDryRunResult>("harness_dry_run", { harnessId, values });
}

export async function listHarnessFileEntries(harnessId: string): Promise<SkillFileEntry[]> {
  return invoke<SkillFileEntry[]>("list_harness_file_entries", { harnessId });
}

export async function readHarnessFile(
  harnessId: string,
  relPath: string,
): Promise<SkillFileContent> {
  return invoke<SkillFileContent>("read_harness_file", { harnessId, relPath });
}

export async function createHarnessWorkspace(
  harnessId: string,
  values: Record<string, string>,
): Promise<CreatedWorkspace> {
  return invoke<CreatedWorkspace>("harness_create", { harnessId, values });
}

export async function listSchedule(): Promise<ScheduleStore> {
  return invoke<ScheduleStore>("schedule_list");
}

export async function setHeartbeat(input: {
  workspaceId: string;
  enabled: boolean;
  intervalMinutes?: number;
}): Promise<HeartbeatConfig> {
  return invoke<HeartbeatConfig>("schedule_set_heartbeat", { input });
}

export async function createScheduledTask(input: {
  workspaceId: string;
  name: string;
  prompt: string;
  cadence: ScheduleCadence;
  enabled?: boolean;
  executionPermission: AcpExecutionPermission;
  maxRunMinutes?: number;
}): Promise<ScheduledTask> {
  return invoke<ScheduledTask>("schedule_create_task", { input });
}

export async function deleteScheduledTask(id: string): Promise<void> {
  return invoke<void>("schedule_delete_task", { id });
}

export async function runScheduleNow(kind: "heartbeat" | "task", refId: string): Promise<RunRecord> {
  return invoke<RunRecord>("schedule_run_now", { kind, refId });
}

export async function listRuns(workspaceId?: string, limit = 50): Promise<RunRecord[]> {
  return invoke<RunRecord[]>("schedule_list_runs", { workspaceId, limit });
}
