import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  Check,
  ChevronRight,
  Eraser,
  FileText,
  FolderOpen,
  KeyRound,
  LayoutDashboard,
  Minus,
  Plus,
  RefreshCcw,
  RefreshCw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type {
  ActionableOnboardingStep,
  AppStatus,
  ControlCenterChrome,
  ControlCenterSurface,
  ContextMenuStatus,
  ControlSectionId,
  DiagnosticsInfo,
  InstallFlowCatalog,
  InstallCommandCatalog,
  InstallProbeStatus,
  InstallSessionSnapshot,
  InstallTaskId,
  KimiCliConfigCenterInput,
  KimiCliConfigCenterView,
  OnboardingStatus,
  RuntimePanelId,
} from "@/app/types";
import {
  formatLoginState,
  ONBOARDING_STEP_ORDER,
} from "@/app/types";
import { DiagnosticItem } from "@/components/common/DiagnosticItem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfigCenterModal } from "@/features/control-center/ConfigCenterModal";
import { InstallFlowModal } from "@/features/control-center/InstallFlowModal";

type StepCompletion = Record<ActionableOnboardingStep, boolean>;
type OnboardingCardId = "install" | "context_menu" | "auth" | "work_dir";

type ControlCenterViewProps = {
  surface: ControlCenterSurface;
  chrome: ControlCenterChrome;
  status: AppStatus | null;
  diagnostics: DiagnosticsInfo | null;
  onboarding: OnboardingStatus | null;
  contextMenuStatus: ContextMenuStatus | null;
  activeControlSection: ControlSectionId;
  activeRuntimePanel: RuntimePanelId;
  stepCompletion: StepCompletion;
  actionBusy: boolean;
  diagnosticsBusy: boolean;
  contextMenuBusy: boolean;
  loginProbeBusy: boolean;
  installBusy: boolean;
  installAction: "dependencies" | "kimi" | "upgrade_kimi" | "nodejs" | null;
  kimiPathInput: string;
  workDirInput: string;
  configCenterView: KimiCliConfigCenterView | null;
  configCenterDraft: KimiCliConfigCenterInput;
  configCenterOpen: boolean;
  configCenterBusy: boolean;
  configCenterDirty: boolean;
  installProbe: InstallProbeStatus | null;
  installSource: "official" | "mirror";
  installFlowOpen: boolean;
  installFlowCatalog: InstallFlowCatalog | null;
  installSessionSnapshot: InstallSessionSnapshot;
  installCommandsOpen: boolean;
  installCommandsBusy: boolean;
  installCommandCatalog: InstallCommandCatalog | null;
  setActiveControlSection: (section: ControlSectionId) => void;
  setActiveRuntimePanel: (panel: RuntimePanelId) => void;
  onWorkDirInputChange: (value: string) => void;
  onRefreshCoreState: () => Promise<void>;
  onRefreshDiagnostics: () => Promise<void>;
  onRefreshContextMenuStatus: () => Promise<void>;
  onRefreshInstallProbe: () => Promise<InstallProbeStatus>;
  onRefreshOnboarding: () => Promise<void>;
  onClose: () => void;
  onOpenOnboardingFromDashboard: () => Promise<void>;
  onOpenRuntimePanelFromDashboard: (panel: RuntimePanelId) => Promise<void>;
  onRetry: () => Promise<void>;
  onOpenLogs: () => Promise<void>;
  onOpenFolder: (path: string) => Promise<void>;
  onOpenKimiConfigDir: () => Promise<void>;
  onPickKimiPath: () => Promise<void>;
  onSavePathAndRetry: () => Promise<void>;
  onEnableContextMenu: () => Promise<void>;
  onDisableContextMenu: () => Promise<void>;
  onProbeLogin: () => Promise<void>;
  onPickWorkDir: () => Promise<void>;
  onSaveWorkDirAndRestart: () => Promise<void>;
  onClearWorkDir: () => Promise<void>;
  onOpenConfigCenterModal: () => Promise<void>;
  onCloseConfigCenterModal: () => void;
  onConfigCenterDraftChange: (next: KimiCliConfigCenterInput) => void;
  onResetConfigCenterDraft: () => void;
  onSaveKimiCliConfigCenter: () => Promise<void>;
  onInstallSourceChange: (source: "official" | "mirror") => void;
  onInstallDependencies: () => Promise<void>;
  onInstallKimi: () => Promise<void>;
  onUpgradeKimi: () => Promise<void>;
  onInstallNodejs: () => Promise<void>;
  onOpenInstallFlow: () => Promise<void>;
  onCloseInstallFlow: () => void;
  onStartInstallTask: (taskId: InstallTaskId) => Promise<void>;
  onCancelInstallTask: () => Promise<void>;
  onOpenInstallCommands: () => Promise<void>;
  onCloseInstallCommands: () => void;
  onCompleteOnboarding: () => Promise<void>;
  onSkipOnboarding: () => Promise<void>;
  onOpenExternalUrl: (url: string) => Promise<void>;
  installMessage: string;
};

const controlSections: Array<{
  id: ControlSectionId;
  label: string;
  description: string;
  icon: ReactNode;
}> = [
  {
    id: "overview",
    label: "概览",
    description: "统计与导航入口",
    icon: <LayoutDashboard size={15} />,
  },
  {
    id: "onboarding",
    label: "引导配置",
    description: "安装与初始化流程",
    icon: <SlidersHorizontal size={15} />,
  },
  {
    id: "runtime_center",
    label: "运行与日志",
    description: "诊断、路径、日志",
    icon: <Activity size={15} />,
  },
];

function StepHeader({
  title,
  done,
  primaryAction,
  secondaryActions,
  collapsible,
  expanded,
  onToggle,
}: {
  title: string;
  done: boolean;
  primaryAction: ReactNode;
  secondaryActions?: ReactNode;
  collapsible: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const titleLine = (
    <h3 className="cc-step-title-line">
      {title}
      <span
        className={done ? "cc-step-done-icon" : "cc-step-pending-icon"}
        aria-label={done ? "已完成" : "未完成"}
      >
        {done ? <Check size={13} /> : <X size={12} />}
      </span>
    </h3>
  );

  return (
    <header className="cc-card-header cc-step-head">
      {collapsible ? (
        <button
          type="button"
          className="cc-step-title-toggle is-collapsible"
          onClick={onToggle}
          aria-expanded={expanded}
        >
          {titleLine}
          <ChevronRight
            size={14}
            className={`cc-step-collapse-icon ${expanded ? "expanded" : ""}`}
            aria-hidden="true"
          />
        </button>
      ) : (
        <div className="cc-step-title-toggle">{titleLine}</div>
      )}
      <div className="cc-step-actions">
        {primaryAction}
        {!collapsible ? secondaryActions : null}
      </div>
    </header>
  );
}

function RuntimePanel({
  active,
  onOpen,
  title,
  description,
  children,
}: {
  active: boolean;
  onOpen: () => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className={`runtime-panel ${active ? "active" : ""}`}>
      <button type="button" className="runtime-panel-head" onClick={onOpen}>
        <div className="runtime-panel-title">
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <ChevronRight size={16} className="runtime-panel-chevron" />
      </button>
      {active && <div className="runtime-panel-body">{children}</div>}
    </section>
  );
}

export function ControlCenterView({
  surface,
  chrome,
  status,
  diagnostics,
  onboarding,
  contextMenuStatus,
  activeControlSection,
  activeRuntimePanel,
  stepCompletion,
  actionBusy,
  diagnosticsBusy,
  contextMenuBusy,
  loginProbeBusy,
  installBusy,
  installAction,
  kimiPathInput,
  workDirInput,
  configCenterView,
  configCenterDraft,
  configCenterOpen,
  configCenterBusy,
  configCenterDirty,
  installProbe,
  installSource,
  installFlowOpen,
  installFlowCatalog,
  installSessionSnapshot,
  installCommandsOpen,
  installCommandsBusy,
  installCommandCatalog,
  setActiveControlSection,
  setActiveRuntimePanel,
  onWorkDirInputChange,
  onRefreshCoreState,
  onRefreshDiagnostics,
  onRefreshContextMenuStatus,
  onRefreshInstallProbe,
  onRefreshOnboarding,
  onClose,
  onOpenOnboardingFromDashboard,
  onOpenRuntimePanelFromDashboard,
  onRetry,
  onOpenLogs,
  onOpenFolder,
  onOpenKimiConfigDir,
  onPickKimiPath,
  onSavePathAndRetry,
  onEnableContextMenu,
  onDisableContextMenu,
  onProbeLogin,
  onPickWorkDir,
  onSaveWorkDirAndRestart,
  onClearWorkDir,
  onOpenConfigCenterModal,
  onCloseConfigCenterModal,
  onConfigCenterDraftChange,
  onResetConfigCenterDraft,
  onSaveKimiCliConfigCenter,
  onInstallSourceChange,
  onInstallDependencies,
  onInstallKimi,
  onUpgradeKimi,
  onInstallNodejs,
  onOpenInstallFlow,
  onCloseInstallFlow,
  onStartInstallTask,
  onCancelInstallTask,
  onOpenInstallCommands,
  onCloseInstallCommands,
  onCompleteOnboarding,
  onSkipOnboarding,
  onOpenExternalUrl,
  installMessage,
}: ControlCenterViewProps) {
  const [authCardView, setAuthCardView] = useState<"login" | "api">("login");
  const [isNarrowOnboarding, setIsNarrowOnboarding] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 480px)").matches
      : false,
  );
  const [installProbeRequested, setInstallProbeRequested] = useState(false);
  const [expandedOnboardingStep, setExpandedOnboardingStep] =
    useState<OnboardingCardId | null>(null);
  const completedSteps = ONBOARDING_STEP_ORDER.filter(
    (step) => stepCompletion[step],
  ).length;
  void installCommandsOpen;
  void installCommandsBusy;
  void installCommandCatalog;
  void onInstallNodejs;
  void onOpenInstallCommands;
  void onCloseInstallCommands;
  const installPathDisplay =
    onboarding?.detectedKimiPath?.trim() ?? kimiPathInput.trim();
  const installSummary = onboarding?.kimiInstalled
    ? `已检测到：${installPathDisplay || "kimi"}`
    : installPathDisplay
      ? `已选择：${installPathDisplay}`
      : "尚未检测到 Kimi CLI，请先安装后点击浏览选择可执行文件路径。";
  const installEnvironmentSummary = installProbe
    ? `Core ${installProbe.coreReady ? "ready" : "missing"} | uv ${installProbe.uvReady ? "ready" : "missing"} | Python 3.13 ${installProbe.python313Ready ? "ready" : "missing"} | Kimi ${installProbe.kimiReady ? "ready" : "missing"}`
    : "No install probe result yet. Click recheck to inspect the local environment.";
  const recentInstallSummary = installSessionSnapshot.title
    ? `${installSessionSnapshot.title}: ${installSessionSnapshot.message ?? installSessionSnapshot.status}`
    : null;
  const effectiveWorkDir = status?.effectiveWorkDir ?? onboarding?.workDir ?? "";
  const canUpgradeKimi = Boolean(
    installProbe?.uvReady && installProbe?.python313Ready && installProbe?.kimiReady,
  );
  const hideInstallControls = true;
  const showSidebar = surface === "fullscreen" || chrome === "full";
  const isDashboardOnlyModal = surface === "modal" && chrome === "dashboard";
  const runtimeContextMenuSupported =
    contextMenuStatus?.supported ?? onboarding?.contextMenuSupported ?? false;
  const runtimeContextMenuEnabled =
    contextMenuStatus?.enabled ?? onboarding?.contextMenuEnabled ?? false;
  const overviewContextMenuLabel = onboarding?.contextMenuSupported
    ? onboarding.contextMenuEnabled
      ? "已启用"
      : "未启用"
    : onboarding
      ? "不支持"
      : "-";

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const media = window.matchMedia("(max-width: 480px)");
    const syncNarrowState = () => {
      setIsNarrowOnboarding(media.matches);
    };

    syncNarrowState();

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", syncNarrowState);
      return () => media.removeEventListener("change", syncNarrowState);
    }

    media.addListener(syncNarrowState);
    return () => media.removeListener(syncNarrowState);
  }, []);

  useEffect(() => {
    if (isNarrowOnboarding) {
      setExpandedOnboardingStep(null);
    }
  }, [isNarrowOnboarding]);

  const toggleOnboardingStep = (step: OnboardingCardId) => {
    if (!isNarrowOnboarding) {
      return;
    }
    const willExpand = expandedOnboardingStep !== step;
    setExpandedOnboardingStep((current) => (current === step ? null : step));
    if (step === "install" && willExpand) {
      void onRefreshInstallProbe();
    }
  };

  const isStepExpanded = (step: OnboardingCardId) =>
    !isNarrowOnboarding || expandedOnboardingStep === step;
  const stepInstallExpanded = isStepExpanded("install");
  const stepContextMenuExpanded = isStepExpanded("context_menu");
  const stepAuthExpanded = isStepExpanded("auth");
  const stepWorkDirExpanded = isStepExpanded("work_dir");

  useEffect(() => {
    if (installProbe) {
      setInstallProbeRequested(true);
      return;
    }
    if (
      installProbeRequested ||
      activeControlSection !== "onboarding" ||
      !stepInstallExpanded
    ) {
      return;
    }
    setInstallProbeRequested(true);
    void onRefreshInstallProbe().catch(() => {
      // Error state is handled by the caller; keep the one-shot gate latched.
    });
  }, [
    activeControlSection,
    installProbe,
    installProbeRequested,
    onRefreshInstallProbe,
    stepInstallExpanded,
  ]);

  const installPrimaryAction = (
    <Button
      type="button"
      icon={<Plus size={15} />}
      className="cc-action-btn"
      onClick={() => void onOpenInstallFlow()}
      disabled={installBusy}
    >
      保存路径并重试
    </Button>
  );
  void installPrimaryAction;

  const installSecondaryAction = (
    <Button
      type="button"
      variant="ghost"
      icon={<RefreshCcw size={15} />}
      className="cc-action-btn"
      onClick={() => void onRefreshInstallProbe()}
      disabled={installBusy}
    >
      重新检测
    </Button>
  );

  const contextMenuPrimaryAction = (
    <Button
      type="button"
      icon={<Plus size={15} />}
      className="cc-action-btn"
      onClick={() => void onEnableContextMenu()}
      disabled={contextMenuBusy || !onboarding?.contextMenuSupported}
    >
      启用右键菜单
    </Button>
  );

  const contextMenuSecondaryAction = (
    <Button
      type="button"
      variant="ghost"
      icon={<Minus size={15} />}
      className="cc-action-btn"
      onClick={() => void onDisableContextMenu()}
      disabled={contextMenuBusy || !onboarding?.contextMenuSupported}
    >
      禁用右键菜单
    </Button>
  );

  const authPrimaryAction =
    authCardView === "login" ? (
      <Button
        type="button"
        icon={<KeyRound size={15} />}
        className="cc-action-btn"
        onClick={() => void onProbeLogin()}
        disabled={loginProbeBusy}
      >
        检测或执行登录
      </Button>
    ) : (
      <Button
        type="button"
        icon={<Check size={14} />}
        className="cc-action-btn"
        onClick={() => void onOpenConfigCenterModal()}
        disabled={actionBusy || configCenterBusy}
      >
        打开配置中心弹窗
      </Button>
    );

  const authSecondaryAction =
    authCardView === "login" ? null : (
      <Button
        type="button"
        variant="ghost"
        icon={<FolderOpen size={14} />}
        className="cc-action-btn"
        onClick={() => void onOpenKimiConfigDir()}
        disabled={actionBusy}
      >
        打开配置目录
      </Button>
    );

  const workDirPrimaryAction = (
    <Button
      type="button"
      icon={<Check size={15} />}
      className="cc-action-btn"
      onClick={() => void onSaveWorkDirAndRestart()}
      disabled={actionBusy}
    >
      保存并重启后端
    </Button>
  );

  const workDirSecondaryAction = (
    <Button
      type="button"
      variant="ghost"
      icon={<Eraser size={15} />}
      className="cc-action-btn"
      onClick={() => void onClearWorkDir()}
      disabled={actionBusy}
    >
      清除并使用默认
    </Button>
  );

  async function handleOpenOnboardingEntry() {
    if (isDashboardOnlyModal) {
      await onOpenOnboardingFromDashboard();
      return;
    }
    try {
      await onRefreshOnboarding();
    } finally {
      setActiveControlSection("onboarding");
    }
  }

  async function handleSelectRuntimePanel(panel: RuntimePanelId) {
    try {
      if (panel === "paths") {
        await Promise.all([onRefreshDiagnostics(), onRefreshContextMenuStatus()]);
      } else {
        await onRefreshDiagnostics();
      }
    } finally {
      setActiveControlSection("runtime_center");
      setActiveRuntimePanel(panel);
    }
  }

  async function handleOpenRuntimeEntry(panel: RuntimePanelId) {
    if (isDashboardOnlyModal) {
      await onOpenRuntimePanelFromDashboard(panel);
      return;
    }
    await handleSelectRuntimePanel(panel);
  }

  async function handleSelectControlSection(section: ControlSectionId) {
    if (section === "overview") {
      setActiveControlSection("overview");
      return;
    }
    if (section === "onboarding") {
      await handleOpenOnboardingEntry();
      return;
    }
    await handleSelectRuntimePanel("paths");
  }

  return (
    <section
      className={`control-center-shell ${surface === "modal" ? "control-center-shell-modal" : ""} ${isDashboardOnlyModal ? "control-center-shell-dashboard" : ""}`}
    >
      {surface === "modal" ? (
        <header className="cc-modal-header">
          <div className="cc-modal-title">
            <h3>控制中心</h3>
            <p>{showSidebar ? "引导配置、诊断与日志管理。" : "运行概览与控制中心入口。"}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            icon={<X size={16} />}
            onClick={onClose}
            aria-label="关闭控制中心"
          />
        </header>
      ) : null}
      <div className={`cc-layout ${showSidebar ? "" : "cc-layout-dashboard"}`}>
        {showSidebar ? (
        <aside className="cc-sidebar">
          <nav className="cc-nav" aria-label="Control center sections">
            {controlSections.map((section) => (
              <Button
                key={section.id}
                type="button"
                variant="ghost"
                size="sm"
                className={`cc-nav-btn ${activeControlSection === section.id ? "active" : ""}`}
                icon={section.icon}
                onClick={() => {
                  void handleSelectControlSection(section.id);
                }}
              >
                <span className="cc-nav-text">
                  <span className="cc-nav-label">{section.label}</span>
                  <span className="cc-nav-desc">{section.description}</span>
                </span>
              </Button>
            ))}
          </nav>
        </aside>
        ) : null}

        <div className={`cc-main ${isDashboardOnlyModal ? "cc-main-dashboard" : ""}`}>
          {activeControlSection === "overview" && (
            <>
              <section className="cc-card">
                <header className="cc-card-header">
                  <h3>Dashboard</h3>
                  <p>运行统计、健康状态与高频动作入口。</p>
                </header>
                <div className="cc-card-body">
                  <div className="cc-dashboard-grid">
                    <article className="cc-metric-card">
                      <span>后端状态</span>
                      <strong>{diagnostics?.state ?? status?.state ?? "-"}</strong>
                    </article>
                    <article className="cc-metric-card">
                      <span>活动端口</span>
                      <strong>
                        {String(diagnostics?.activePort ?? status?.activePort ?? "-")}
                      </strong>
                    </article>
                    <article className="cc-metric-card">
                      <span>工作区端口</span>
                      <strong>
                        {String(
                          diagnostics?.workspacePort ?? status?.workspacePort ?? "-",
                        )}
                      </strong>
                    </article>
                    <article className="cc-metric-card">
                      <span>后端就绪(ms)</span>
                      <strong>
                        {String(
                          diagnostics?.backendReadyMs ?? status?.backendReadyMs ?? "-",
                        )}
                      </strong>
                    </article>
                    <article className="cc-metric-card">
                      <span>引导完成度</span>
                      <strong>
                        {completedSteps}/{ONBOARDING_STEP_ORDER.length}
                      </strong>
                    </article>
                    <article className="cc-metric-card">
                      <span>右键菜单</span>
                      <strong>{overviewContextMenuLabel}</strong>
                    </article>
                  </div>
                  <div className="cc-actions">
                    <Button
                      type="button"
                      icon={<RefreshCw size={15} />}
                      className="cc-action-btn"
                      onClick={() => {
                        void onRefreshCoreState();
                        void onRefreshDiagnostics();
                        void onRefreshContextMenuStatus();
                      }}
                      disabled={diagnosticsBusy || contextMenuBusy}
                    >
                      刷新全部状态
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      icon={<RefreshCcw size={15} />}
                      className="cc-action-btn"
                      onClick={() => void onRetry()}
                      disabled={actionBusy}
                    >
                      重启后端
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      icon={<FolderOpen size={15} />}
                      className="cc-action-btn"
                      onClick={() => void onOpenLogs()}
                    >
                      打开日志目录
                    </Button>
                  </div>
                </div>
              </section>

              <section className="cc-card">
                <header className="cc-card-header">
                  <h3>模块入口</h3>
                  <p>快速进入引导配置、诊断与日志模块。</p>
                </header>
                <div className="cc-card-body">
                  <div className="cc-entry-actions">
                    <Button
                      type="button"
                      icon={<SlidersHorizontal size={15} />}
                      className="cc-action-btn"
                      onClick={() => {
                        void handleOpenOnboardingEntry();
                      }}
                    >
                      进入引导配置
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      icon={<Activity size={15} />}
                      className="cc-action-btn"
                      onClick={() => {
                        void handleOpenRuntimeEntry("core");
                      }}
                    >
                      进入核心诊断
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      icon={<FileText size={15} />}
                      className="cc-action-btn"
                      onClick={() => {
                        void handleOpenRuntimeEntry("paths");
                      }}
                    >
                      进入路径与菜单
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      icon={<FileText size={15} />}
                      className="cc-action-btn"
                      onClick={() => {
                        void handleOpenRuntimeEntry("logs");
                      }}
                    >
                      进入最近日志
                    </Button>
                  </div>
                </div>
              </section>
            </>
          )}

          {activeControlSection === "onboarding" && (
            <>
              <section className="cc-card cc-step-card">
                <StepHeader
                  title="1. 安装 Kimi CLI"
                  done={stepCompletion.install_kimi}
                  collapsible={isNarrowOnboarding}
                  expanded={stepInstallExpanded}
                  onToggle={() => toggleOnboardingStep("install")}
                  primaryAction={
                    <Button
                      type="button"
                      icon={<Plus size={15} />}
                      className="cc-action-btn"
                      onClick={() => void onOpenInstallFlow()}
                      disabled={installBusy}
                    >
                      打开安装与升级
                    </Button>
                  }
                  secondaryActions={installSecondaryAction}
                />
                {stepInstallExpanded ? (
                  <div className="cc-card-body cc-step-body cc-step-body-single">
                    <div className="cc-step-main">
                      {isNarrowOnboarding ? (
                        <div className="cc-step-secondary-actions">
                          {installSecondaryAction}
                        </div>
                      ) : null}
                      <div className="cc-install-top-row">
                        <p className="hint cc-step-summary cc-inline-path">
                          {installSummary}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          className="cc-action-btn cc-inline-btn"
                          onClick={() => void onPickKimiPath()}
                        >
                          浏览
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          icon={<FileText size={14} />}
                          className="cc-action-btn"
                          onClick={() =>
                            void onOpenExternalUrl(
                              "https://www.kimi.com/code/docs/kimi-cli/guides/getting-started.html",
                            )
                          }
                        >
                          打开官方文档
                        </Button>
                      </div>

                      {!hideInstallControls ? (
                        <div className="cc-install-action-row">
                          <div className="cc-source-switch" role="group" aria-label="安装源">
                            <button
                              type="button"
                              className={`cc-source-switch-btn ${installSource === "official" ? "active" : ""}`}
                              onClick={() => onInstallSourceChange("official")}
                              disabled={installBusy}
                            >
                              官方源
                            </button>
                            <button
                              type="button"
                              className={`cc-source-switch-btn ${installSource === "mirror" ? "active" : ""}`}
                              onClick={() => onInstallSourceChange("mirror")}
                              disabled={installBusy}
                            >
                              镜像源
                            </button>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            icon={<Plus size={15} />}
                            className="cc-action-btn"
                            onClick={() => void onInstallDependencies()}
                            disabled={installBusy}
                          >
                            一键安装依赖
                          </Button>
                          <Button
                            type="button"
                            icon={<Check size={15} />}
                            className="cc-action-btn"
                            onClick={() => void onInstallKimi()}
                            disabled={installBusy}
                          >
                            安装 Kimi
                          </Button>
                        </div>
                      ) : null}
                      <div className="cc-install-command-row">
                        <Button
                          type="button"
                          variant="outline"
                          icon={<Plus size={14} />}
                          className="cc-action-btn cc-install-open-flow-btn"
                          onClick={() => void onOpenInstallFlow()}
                          disabled={installBusy}
                        >
                          查看完整安装命令
                        </Button>
                      </div>
                      <p className="hint cc-step-meta">{installEnvironmentSummary}</p>
                      {recentInstallSummary ? (
                        <p className="hint cc-step-meta">{recentInstallSummary}</p>
                      ) : null}
                      {false ? (
                      <div className="cc-install-action-row">
                        <div className="cc-source-switch" role="group" aria-label="安装源">
                          <button
                            type="button"
                            className={`cc-source-switch-btn ${installSource === "official" ? "active" : ""}`}
                            onClick={() => onInstallSourceChange("official")}
                            disabled={installBusy}
                          >
                            官方源
                          </button>
                          <button
                            type="button"
                            className={`cc-source-switch-btn ${installSource === "mirror" ? "active" : ""}`}
                            onClick={() => onInstallSourceChange("mirror")}
                            disabled={installBusy}
                          >
                            镜像源
                          </button>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          icon={<Plus size={15} />}
                          className="cc-action-btn cc-install-save-path-btn"
                          onClick={() => void onInstallDependencies()}
                          disabled={installBusy}
                        >
                          安装依赖（Git / uv）
                        </Button>
                        <Button
                          type="button"
                          icon={<Check size={15} />}
                          className="cc-action-btn cc-install-save-path-btn"
                          onClick={() => void onInstallKimi()}
                          disabled={installBusy}
                        >
                          安装 Kimi
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          icon={<RefreshCw size={15} />}
                          className="cc-action-btn"
                          onClick={() => void onUpgradeKimi()}
                          disabled={installBusy || !canUpgradeKimi}
                        >
                          升级 Kimi
                        </Button>
                      </div>) : null}
                      <div className="cc-install-secondary-row">
                        <Button
                          type="button"
                          variant="outline"
                          icon={<Check size={15} />}
                          className="cc-action-btn cc-install-save-path-btn"
                          onClick={() => void onSavePathAndRetry()}
                          disabled={actionBusy || !kimiPathInput.trim()}
                        >
                          安装 Node.js
                        </Button>
                      </div>
                      {installBusy && installAction ? (
                        <p className="hint cc-step-meta">
                          当前动作：
                          {installAction === "dependencies"
                            ? "安装依赖"
                            : installAction === "kimi"
                              ? "安装 Kimi"
                              : installAction === "upgrade_kimi"
                                ? "升级 Kimi"
                                : "安装 Node.js"}
                        </p>
                      ) : null}
                      {installMessage ? (
                        <p className="hint cc-step-meta">{installMessage}</p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="cc-card cc-step-card">
                <StepHeader
                  title="2. 资源管理器右键菜单"
                  done={stepCompletion.context_menu}
                  collapsible={isNarrowOnboarding}
                  expanded={stepContextMenuExpanded}
                  onToggle={() => toggleOnboardingStep("context_menu")}
                  primaryAction={contextMenuPrimaryAction}
                  secondaryActions={contextMenuSecondaryAction}
                />
                {stepContextMenuExpanded ? (
                  <div className="cc-card-body cc-step-body">
                    <div className="cc-step-main">
                      {isNarrowOnboarding ? (
                        <div className="cc-step-secondary-actions">
                          {contextMenuSecondaryAction}
                        </div>
                      ) : null}
                      <p className="hint cc-step-summary">
                        {onboarding?.contextMenuSupported
                          ? `当前状态：${onboarding.contextMenuEnabled ? "已启用" : "未启用"}`
                          : "当前平台不支持该功能。"}
                      </p>
                      {onboarding?.contextMenuMessage ? (
                        <p className="hint cc-step-meta">{onboarding.contextMenuMessage}</p>
                      ) : null}
                    </div>
                    <div className="cc-step-side cc-step-side-empty" />
                  </div>
                ) : null}
              </section>

              <section className="cc-card cc-step-card">
                <StepHeader
                  title="3. Kimi 登录与 Provider API 配置"
                  done={stepCompletion.login_kimi && stepCompletion.api_config}
                  collapsible={isNarrowOnboarding}
                  expanded={stepAuthExpanded}
                  onToggle={() => toggleOnboardingStep("auth")}
                  primaryAction={authPrimaryAction}
                  secondaryActions={authSecondaryAction}
                />
                {stepAuthExpanded ? (
                  <div className="cc-card-body cc-step-body cc-step-body-single">
                    <div className="cc-step-main">
                      {isNarrowOnboarding && authSecondaryAction ? (
                        <div className="cc-step-secondary-actions">
                          {authSecondaryAction}
                        </div>
                      ) : null}
                      <div className="cc-auth-switch" role="group" aria-label="登录与 API 配置切换">
                        <button
                          type="button"
                          className={`cc-auth-switch-btn ${authCardView === "login" ? "active" : ""}`}
                          onClick={() => setAuthCardView("login")}
                        >
                          Kimi 登录
                        </button>
                        <button
                          type="button"
                          className={`cc-auth-switch-btn ${authCardView === "api" ? "active" : ""}`}
                          onClick={() => setAuthCardView("api")}
                        >
                          Provider API
                        </button>
                      </div>

                      {authCardView === "login" ? (
                        <div className="cc-auth-panel">
                          <p className="hint cc-step-summary">
                            当前状态：{formatLoginState(onboarding?.loginState)}
                          </p>
                        </div>
                      ) : (
                        <div className="cc-auth-panel">
                          <p className="hint cc-step-summary">
                            已配置 providers：<strong>{configCenterView?.providers.length ?? 0}</strong>；
                            models：<strong>{configCenterView?.models.length ?? 0}</strong>；
                            services：<strong>{configCenterView?.services.length ?? 0}</strong>
                          </p>
                          <div className="cc-api-inline-actions">
                            <Button
                              type="button"
                              variant="outline"
                              icon={<Check size={14} />}
                              className="cc-action-btn"
                              onClick={() => void onOpenConfigCenterModal()}
                              disabled={configCenterBusy}
                            >
                              打开配置中心弹窗
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              icon={<FolderOpen size={14} />}
                              className="cc-action-btn"
                              onClick={() => void onOpenKimiConfigDir()}
                            >
                              打开配置目录
                            </Button>
                          </div>
                          <p className="hint cc-step-meta">
                            配置文件：
                            <strong>
                              {configCenterView?.configPath || "~/.kimi/config.toml"}
                            </strong>
                          </p>
                          {configCenterDirty ? (
                            <p className="hint cc-step-meta">配置中心弹窗内存在未保存修改。</p>
                          ) : null}
                          {configCenterView?.warnings?.length ? (
                            <p className="hint cc-step-meta">
                              当前警告：{configCenterView.warnings[0]}
                            </p>
                          ) : null}
                          <p className="hint cc-step-meta">
                            保存成功后将自动标记本步骤完成。
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="cc-card cc-step-card">
                <StepHeader
                  title="4. 默认工作目录"
                  done={stepCompletion.work_dir}
                  collapsible={isNarrowOnboarding}
                  expanded={stepWorkDirExpanded}
                  onToggle={() => toggleOnboardingStep("work_dir")}
                  primaryAction={workDirPrimaryAction}
                  secondaryActions={workDirSecondaryAction}
                />
                {stepWorkDirExpanded ? (
                  <div className="cc-card-body cc-step-body cc-step-body-single">
                    <div className="cc-step-main">
                      {isNarrowOnboarding ? (
                        <div className="cc-step-secondary-actions">
                          {workDirSecondaryAction}
                        </div>
                      ) : null}
                      <div className="cc-workdir-row">
                        <Input
                          id="work-dir-onboarding"
                          value={workDirInput}
                          onChange={(event) => onWorkDirInputChange(event.currentTarget.value)}
                          placeholder="D:\\Projects\\your-repo"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="cc-action-btn cc-inline-btn"
                          onClick={() => void onPickWorkDir()}
                        >
                          浏览
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          icon={<FolderOpen size={14} />}
                          className="cc-inline-icon-btn"
                          onClick={() => void onOpenFolder(effectiveWorkDir.trim())}
                          disabled={!effectiveWorkDir.trim()}
                          aria-label="打开当前生效目录"
                          title="打开当前生效目录"
                        />
                        <p className="hint cc-inline-meta">
                          当前生效目录：
                          <strong>{effectiveWorkDir || "-"}</strong>
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="cc-onboarding-flow-actions">
                <div className="cc-actions">
                  <Button
                    type="button"
                    icon={<Check size={15} />}
                    className="cc-action-btn"
                    onClick={() => void onCompleteOnboarding()}
                    disabled={actionBusy}
                  >
                    完成引导
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    icon={<ChevronRight size={15} />}
                    className="cc-action-btn"
                    onClick={() => void onSkipOnboarding()}
                    disabled={actionBusy}
                  >
                    暂时跳过
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    icon={<RefreshCcw size={15} />}
                    className="cc-action-btn"
                    onClick={() => void onRetry()}
                    disabled={actionBusy}
                  >
                    重启后端
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    icon={<RefreshCw size={15} />}
                    className="cc-action-btn"
                    onClick={() => {
                      void onRefreshOnboarding();
                      void onRefreshDiagnostics();
                      void onRefreshContextMenuStatus();
                    }}
                    disabled={diagnosticsBusy || contextMenuBusy}
                  >
                    刷新运行态数据
                  </Button>
                </div>
              </section>
            </>
          )}

          {activeControlSection === "runtime_center" && (
            <section className="cc-card runtime-accordion">
              <RuntimePanel active={activeRuntimePanel === "core"} onOpen={() => { void handleSelectRuntimePanel("core"); }} title="核心运行诊断" description="端口、启动指标、版本与最后错误信息。">
                <div className="cc-actions">
                  <Button type="button" icon={<RefreshCw size={15} />} className="cc-action-btn" onClick={() => void onRefreshDiagnostics()} disabled={diagnosticsBusy}>刷新诊断</Button>
                  <Button type="button" variant="ghost" icon={<RefreshCcw size={15} />} className="cc-action-btn" onClick={() => void onRefreshContextMenuStatus()} disabled={contextMenuBusy}>刷新右键菜单状态</Button>
                </div>
                <div className="diagnostics-grid">
                  <DiagnosticItem label="State" value={diagnostics?.state ?? "-"} />
                  <DiagnosticItem label="Active Port" value={String(diagnostics?.activePort ?? "-")} />
                  <DiagnosticItem label="Workspace Port" value={String(diagnostics?.workspacePort ?? "-")} />
                  <DiagnosticItem label="Base Port" value={String(diagnostics?.basePort ?? "-")} />
                  <DiagnosticItem label="Instance ID" value={diagnostics?.instanceId ?? "-"} />
                  <DiagnosticItem label="PID" value={String(diagnostics?.pid ?? "-")} />
                  <DiagnosticItem label="Start Cycle ID" value={String(diagnostics?.startCycleId ?? "-")} />
                  <DiagnosticItem label="Hotkey Owner" value={String(diagnostics?.isHotkeyOwner ?? false)} />
                  <DiagnosticItem label="Shell to Loading (ms)" value={String(diagnostics?.loadingStartupMs ?? "-")} />
                  <DiagnosticItem label="Backend Ready (ms)" value={String(diagnostics?.backendReadyMs ?? "-")} />
                  <DiagnosticItem label="Loading SLA Met" value={String(diagnostics?.loadingSlaMet ?? "-")} />
                  <DiagnosticItem label="CLI Contract OK" value={String(diagnostics?.cliContractOk ?? "-")} />
                  <DiagnosticItem label="CLI Contract Error" value={diagnostics?.cliContractError ?? "-"} />
                  <DiagnosticItem label="Kimi Version" value={diagnostics?.kimiVersion ?? "-"} />
                  <DiagnosticItem label="Version Check Error" value={diagnostics?.versionError ?? "-"} />
                  <DiagnosticItem label="Last Error" value={diagnostics?.lastError ?? "-"} />
                  <DiagnosticItem label="Last Exit Reason" value={diagnostics?.lastExitReason ?? "-"} />
                  <DiagnosticItem label="WebView Runtime" value={diagnostics?.webviewRuntimeKind ?? "-"} />
                  <DiagnosticItem label="WebView Version" value={diagnostics?.webviewRuntimeVersion ?? "-"} />
                  <DiagnosticItem label="Startup Pending" value={String(diagnostics?.startupPending ?? false)} />
                  <DiagnosticItem label="Startup Exit Cause" value={diagnostics?.startupExitCause ?? "-"} />
                  <DiagnosticItem label="Main Create Mode" value={diagnostics?.mainCreateMode ?? "-"} />
                  <DiagnosticItem label="Startup Attempt ID" value={String(diagnostics?.startupAttemptId ?? "-")} />
                  <DiagnosticItem label="Startup Phase" value={diagnostics?.startupPhase ?? "-"} />
                  <DiagnosticItem label="Startup Failure Kind" value={diagnostics?.startupFailureKind ?? "-"} />
                  <DiagnosticItem label="Startup Failure Detail" value={diagnostics?.startupFailureDetail ?? "-"} />
                  <DiagnosticItem label="Startup Monitor State" value={diagnostics?.startupMonitorState ?? "-"} />
                  <DiagnosticItem label="Startup Monitor Reason" value={diagnostics?.startupMonitorReason ?? "-"} />
                  <DiagnosticItem label="Startup Monitor Target" value={diagnostics?.startupMonitorTargetRoute ?? "-"} />
                  <DiagnosticItem label="Startup Monitor Detail" value={diagnostics?.startupMonitorDetail ?? "-"} />
                </div>
                <h4 className="log-tail-title">最近启动轨迹</h4>
                <pre className="log-tail">{diagnostics?.startupTrace && diagnostics.startupTrace.length > 0 ? diagnostics.startupTrace.join("\n") : "暂无启动轨迹。"}</pre>
              </RuntimePanel>

              <RuntimePanel active={activeRuntimePanel === "paths"} onOpen={() => { void handleSelectRuntimePanel("paths"); }} title="路径与上下文菜单" description="查看路径配置并管理资源管理器右键菜单。">
                <p className="hint">{runtimeContextMenuSupported ? `右键菜单：${runtimeContextMenuEnabled ? "已启用" : "未启用"}` : "右键菜单：当前平台不支持"}</p>
                {contextMenuStatus?.message && <p className="hint">{contextMenuStatus.message}</p>}
                <div className="cc-actions">
                  <Button type="button" icon={<Plus size={15} />} className="cc-action-btn" onClick={() => void onEnableContextMenu()} disabled={contextMenuBusy || !runtimeContextMenuSupported}>启用右键菜单</Button>
                  <Button type="button" variant="ghost" icon={<Minus size={15} />} className="cc-action-btn" onClick={() => void onDisableContextMenu()} disabled={contextMenuBusy || !runtimeContextMenuSupported}>禁用右键菜单</Button>
                  <Button type="button" variant="ghost" icon={<FolderOpen size={15} />} className="cc-action-btn" onClick={() => void onOpenLogs()}>打开日志目录</Button>
                </div>
                <div className="diagnostics-grid">
                  <DiagnosticItem label="Started At (Epoch UTC)" value={diagnostics?.startedAt ?? "-"} />
                  <DiagnosticItem label="Configured Kimi Path" value={diagnostics?.configuredKimiPath ?? "-"} />
                  <DiagnosticItem label="Detected Kimi Path" value={diagnostics?.detectedKimiPath ?? "-"} />
                  <DiagnosticItem label="Configured Work Dir" value={diagnostics?.configuredWorkDir ?? "-"} />
                  <DiagnosticItem label="Effective Work Dir" value={diagnostics?.effectiveWorkDir ?? "-"} />
                  <DiagnosticItem label="Launch Command" value={diagnostics?.launchCommand ?? "-"} />
                  <DiagnosticItem label="App Log Path" value={diagnostics?.appLogPath ?? "-"} />
                  <DiagnosticItem label="Backend Log Path" value={diagnostics?.backendLogPath ?? "-"} />
                  <DiagnosticItem label="Logs Directory" value={diagnostics?.logsDir ?? "-"} />
                </div>
              </RuntimePanel>

              <RuntimePanel active={activeRuntimePanel === "logs"} onOpen={() => { void handleSelectRuntimePanel("logs"); }} title="最近日志" description="快速查看应用与后端日志尾部内容。">
                <h4 className="log-tail-title">最近应用日志</h4>
                <pre className="log-tail">{diagnostics?.appLogTail && diagnostics.appLogTail.length > 0 ? diagnostics.appLogTail.join("\n") : "暂无应用日志。"}</pre>
                <h4 className="log-tail-title">最近后端日志</h4>
                <pre className="log-tail">{diagnostics?.backendLogTail && diagnostics.backendLogTail.length > 0 ? diagnostics.backendLogTail.join("\n") : "暂无后端日志。"}</pre>
              </RuntimePanel>
            </section>
          )}
        </div>
      </div>
      {showSidebar ? (
        <ConfigCenterModal
          open={configCenterOpen}
          busy={configCenterBusy || actionBusy}
          dirty={configCenterDirty}
          view={configCenterView}
          draft={configCenterDraft}
          onDraftChange={onConfigCenterDraftChange}
          onClose={onCloseConfigCenterModal}
          onSave={onSaveKimiCliConfigCenter}
          onReset={onResetConfigCenterDraft}
          onOpenConfigDir={onOpenKimiConfigDir}
        />
      ) : null}
      <InstallFlowModal
        open={installFlowOpen}
        catalog={installFlowCatalog}
        session={installSessionSnapshot}
        probe={installProbe}
        backendState={status?.state ?? null}
        installSource={installSource}
        onClose={onCloseInstallFlow}
        onRefreshProbe={onRefreshInstallProbe}
        onSourceChange={onInstallSourceChange}
        onStartTask={onStartInstallTask}
        onCancelTask={onCancelInstallTask}
        onRestartBackend={onRetry}
        restartBusy={actionBusy}
      />
    </section>
  );
}
