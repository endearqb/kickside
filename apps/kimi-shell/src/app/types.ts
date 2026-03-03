export type BackendState =
  | "stopped"
  | "starting"
  | "running"
  | "crashed"
  | "stopping"
  | "missing_kimi";

export type LoginProbeState = "logged_in" | "login_required" | "unknown";

export type OnboardingStep =
  | "install_kimi"
  | "context_menu"
  | "login_kimi"
  | "work_dir"
  | "api_config"
  | "done";

export type ActionableOnboardingStep = Exclude<OnboardingStep, "done">;

export interface AppStatus {
  instanceId: string;
  pid: number;
  startedAt: string;
  isHotkeyOwner: boolean;
  startCycleId: number;
  state: BackendState;
  activePort?: number;
  workspacePort?: number;
  basePort?: number;
  loadingStartupMs?: number;
  backendReadyMs?: number;
  loadingSlaMet?: boolean;
  message?: string;
  detectedKimiPath?: string;
  configuredKimiPath?: string;
  configuredWorkDir?: string;
  effectiveWorkDir?: string;
  logsDir: string;
  hotkey: string;
}

export interface DiagnosticsInfo {
  instanceId: string;
  pid: number;
  startedAt: string;
  isHotkeyOwner: boolean;
  startCycleId: number;
  state: BackendState;
  activePort?: number;
  workspacePort?: number;
  basePort?: number;
  loadingStartupMs?: number;
  backendReadyMs?: number;
  loadingSlaMet?: boolean;
  configuredKimiPath?: string;
  detectedKimiPath?: string;
  configuredWorkDir?: string;
  effectiveWorkDir?: string;
  launchCommand?: string;
  cliContractOk?: boolean;
  cliContractError?: string;
  kimiVersion?: string;
  versionError?: string;
  lastError?: string;
  lastExitReason?: string;
  appLogPath: string;
  backendLogPath: string;
  appLogTail: string[];
  backendLogTail: string[];
  logTail: string[];
  logsDir: string;
}

export interface ContextMenuStatus {
  supported: boolean;
  enabled: boolean;
  message?: string;
}

export interface OnboardingStatus {
  currentVersion: number;
  completedVersion: number;
  shouldShowOnboarding: boolean;
  launchBlockedByOnboarding: boolean;
  startupOpenRequestApplied: boolean;
  recommendedStep: OnboardingStep;
  kimiInstalled: boolean;
  detectedKimiPath?: string;
  contextMenuSupported: boolean;
  contextMenuEnabled: boolean;
  contextMenuMessage?: string;
  loginState: LoginProbeState;
  loginMessage?: string;
  workDirConfigured: boolean;
  workDir?: string;
  apiConfigAck: boolean;
}

export interface LoginProbeResult {
  state: LoginProbeState;
  message: string;
  kimiPath?: string;
  exitCode?: number;
}

export interface KimiCliApiConfigView {
  configPath: string;
  providerId?: string;
  model?: string;
  baseUrl?: string;
  hasApiKey: boolean;
}

export interface KimiCliApiConfigInput {
  providerId: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
}

export interface InstallProbeStatus {
  gitReady: boolean;
  uvReady: boolean;
  python313Ready: boolean;
  kimiReady: boolean;
}

export type Screen = "loading" | "control_center" | "workspace";

export type WorkspaceEmbedState = "idle" | "loading" | "ready" | "blocked";

export type Theme = "light" | "dark";

export type ControlSectionId =
  | "overview"
  | "onboarding"
  | "runtime_center";

export type RuntimePanelId = "core" | "paths" | "logs";

export const ONBOARDING_STEP_ORDER: ActionableOnboardingStep[] = [
  "install_kimi",
  "context_menu",
  "login_kimi",
  "work_dir",
  "api_config",
];

export function stepTitle(step: OnboardingStep): string {
  switch (step) {
    case "install_kimi":
      return "安装 Kimi CLI";
    case "context_menu":
      return "启用右键菜单";
    case "login_kimi":
      return "登录 Kimi";
    case "work_dir":
      return "设置工作目录";
    case "api_config":
      return "配置 Provider API";
    default:
      return "完成";
  }
}

export function formatLoginState(state?: LoginProbeState): string {
  if (state === "logged_in") return "已登录";
  if (state === "login_required") return "需要登录";
  return "未知";
}

export function formatBackendState(state?: BackendState): string {
  if (!state) return "Unknown";
  if (state === "missing_kimi") return "Missing Kimi";
  return state
    .split("_")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}
