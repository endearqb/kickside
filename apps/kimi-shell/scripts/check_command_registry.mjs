import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const commandsPath = path.resolve(process.cwd(), "src-tauri", "src", "commands.rs");
const buildPath = path.resolve(process.cwd(), "src-tauri", "build.rs");
const permissionPath = path.resolve(
  process.cwd(),
  "src-tauri",
  "permissions",
  "command-access.toml",
);
const capabilityPath = path.resolve(process.cwd(), "src-tauri", "capabilities", "default.json");
const architecturePath = path.resolve(process.cwd(), "..", "..", ".ai", "architecture", "current-state.md");
const source = fs.readFileSync(commandsPath, "utf8");
const match = source.match(/tauri::generate_handler!\[\s*([\s\S]*?)\s*\]/);
const errors = [];

if (!match) {
  errors.push("could not find tauri generate_handler command list");
}

const registeredCommands = match
  ? match[1]
      .replace(/\/\/.*$/gm, "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => item.replace(/^super::/, ""))
  : [];

const commandRegistry = {
  runtime: [
    "get_app_status",
    "get_workspace_embed_url",
    "retry_start_backend",
    "restart_backend_runtime_only",
    "report_loading_rendered",
    "notify_frontend_ready",
    "get_startup_monitor_status",
    "complete_startup_monitor_route",
    "submit_prefill",
    "recover_main_window_boot",
    "quit_app_gracefully",
    "get_main_window_close_behavior",
    "save_main_window_close_behavior",
    "get_workspace_web_settings",
    "save_workspace_web_settings",
    "fallback_workspace_web_to_official",
    "mark_enhanced_web_ready",
    "submit_main_window_close_decision",
    "save_kimi_path",
    "save_work_dir",
  ],
  workspace_grid: [
    "workspace_grid::grid_list_sessions",
    "workspace_grid::grid_get_session",
    "workspace_grid::grid_create_session",
  ],
  bridge: [
    "bridge::get_bridge_settings",
    "bridge::save_bridge_settings",
    "bridge::delete_bridge_connector",
    "bridge::save_bridge_onboarding_config",
    "bridge::get_bridge_status",
    "bridge::start_bridge",
    "bridge::stop_bridge",
    "bridge::restart_bridge",
    "bridge::list_bridge_bindings",
    "bridge::list_bridge_sessions",
    "bridge::clear_bridge_binding",
    "bridge::reset_bridge_binding_session",
    "bridge::reset_bridge_binding_to_default_work_dir",
    "bridge::list_bridge_approvals",
    "bridge::resolve_bridge_approval",
    "bridge::import_bridge_session",
    "bridge::get_bridge_log_tail",
    "bridge::get_bridge_secrets_mask_view",
    "bridge::save_bridge_connector_secrets",
    "bridge::start_feishu_connector_onboarding",
    "bridge::get_feishu_connector_onboarding_status",
    "bridge::cancel_feishu_connector_onboarding",
    "bridge::start_weixin_connector_onboarding",
    "bridge::get_weixin_connector_onboarding_status",
    "bridge::cancel_weixin_connector_onboarding",
  ],
  skills: [
    "skills::install_skill_from_git",
    "skills::import_skill_from_path",
    "skills::scan_discoverable_skills",
    "skills::list_skill_discovery_workspaces",
    "skills::list_workspace_skill_targets",
    "skills::get_workspace_skill_inventory",
    "skills::add_installed_skill_to_workspace_target",
    "skills::remove_workspace_target_skill",
    "skills::get_discovered_skill_detail",
    "skills::import_discovered_skill",
    "skills::list_installed_skills",
    "skills::get_skill_detail",
    "skills::list_skill_file_entries",
    "skills::read_skill_file",
    "skills::get_skill_usage_stats",
    "skills::list_discovered_skill_file_entries",
    "skills::read_discovered_skill_file",
    "skills::set_skill_trust",
    "skills::apply_skill",
    "skills::remove_skill",
    "skills::list_active_session_skills",
    "skills::list_global_skills",
    "skills::list_workspace_recent_skills",
    "skills::get_workspace_skill_profile",
    "skills::set_workspace_skill_pin",
    "skills::get_workspace_skill_recommendations",
    "skills::update_skill",
    "skills::uninstall_skill",
    "skills::cleanup_session_skill_projections",
  ],
  workspace_hub: [
    "workspaces::workspace_list",
    "workspaces::workspace_register",
    "workspaces::workspace_register_many",
    "workspaces::workspace_mark_opened",
    "workspaces::workspace_remove",
    "workspaces::workspace_list_file_entries",
    "workspaces::workspace_read_file",
  ],
  harness: [
    "harness::harness_list",
    "harness::harness_get",
    "harness::harness_dry_run",
    "harness::list_harness_file_entries",
    "harness::read_harness_file",
    "harness::harness_create",
  ],
  scheduler: [
    "scheduler::schedule_list",
    "scheduler::schedule_set_heartbeat",
    "scheduler::schedule_create_task",
    "scheduler::schedule_update_task",
    "scheduler::schedule_delete_task",
    "scheduler::schedule_run_now",
    "scheduler::schedule_list_runs",
  ],
  diagnostics: [
    "get_diagnostics",
    "open_logs_folder",
    "open_external_url",
    "open_folder",
    "open_kimi_config_dir",
    "load_kimi_code_access_config",
    "save_kimi_code_access_config",
    "test_kimi_code_access_config",
    "run_kimi_doctor",
  ],
  install: [
    "install::register_install_session_channel",
    "install::get_install_flow_catalog",
    "install::get_install_session_snapshot",
    "install::start_install_task",
    "install::cancel_install_task",
    "install::get_install_probe_status",
    "install::get_install_settings",
    "install::save_install_settings",
    "install::get_install_mirror_health_report",
    "install::get_powershell_preflight",
  ],
  install_compat: [
    "install::install_kimi_dependencies",
    "install::install_kimi_code",
    "install::upgrade_kimi_code",
    "install::uninstall_kimi_code",
    "install::install_nodejs",
  ],
  context_menu: [
    "context_menu::get_context_menu_status",
    "context_menu::enable_context_menu",
    "context_menu::disable_context_menu",
    "context_menu::save_context_menu_labels",
  ],
  workspace_import: [
    "workspace_import::list_workspace_import_targets",
    "workspace_import::get_active_workspace_import_request",
    "workspace_import::complete_workspace_import_request",
    "workspace_import::cancel_workspace_import_request",
  ],
  onboarding_auth: [
    "get_onboarding_status",
    "complete_onboarding",
    "skip_onboarding",
    "ack_api_config_step",
    "start_kimi_code_auth",
    "refresh_kimi_code_auth",
    "logout_kimi_code_auth",
  ],
};

const commandDomainMetadata = {
  runtime: {
    owner: "shell-runtime",
    windowCapability: "main,prefill",
    purpose: "backend lifecycle, startup handoff, workspace web settings, and persisted shell settings",
  },
  workspace_grid: {
    owner: "workspace-grid",
    windowCapability: "main",
    purpose: "workspace/session lookup and creation for Workspace Grid panes",
  },
  bridge: {
    owner: "im-bridge",
    windowCapability: "main",
    purpose: "IM Bridge settings, runtime controls, bindings, approvals, logs, and onboarding",
  },
  skills: {
    owner: "skill-center",
    windowCapability: "main",
    purpose: "skill discovery, import, trust, projection, recommendation, and lifecycle actions",
  },
  workspace_hub: {
    owner: "workspace-hub",
    windowCapability: "main",
    purpose: "registered workspace listing and lifecycle metadata",
  },
  harness: {
    owner: "harness",
    windowCapability: "main",
    purpose: "harness listing, inspection, dry-run, file read, and creation",
  },
  scheduler: {
    owner: "scheduler",
    windowCapability: "main",
    purpose: "scheduled task configuration, heartbeat, manual run, and run history",
  },
  diagnostics: {
    owner: "diagnostics",
    windowCapability: "main,prefill",
    purpose: "diagnostics, safe external/open-folder actions, Kimi access config, and Kimi doctor",
  },
  install: {
    owner: "install-center",
    windowCapability: "main",
    purpose: "install task catalog, session controls, settings, probes, mirrors, and PowerShell preflight",
  },
  install_compat: {
    owner: "install-center",
    windowCapability: "main",
    purpose: "registered compatibility commands for old install entry points pending sunset",
  },
  context_menu: {
    owner: "context-menu",
    windowCapability: "main",
    purpose: "Windows Explorer context-menu status, labels, and registration controls",
  },
  workspace_import: {
    owner: "workspace-import",
    windowCapability: "main,workspace-import-picker",
    purpose: "workspace import target listing, active request state, completion, and cancellation",
  },
  onboarding_auth: {
    owner: "onboarding-auth",
    windowCapability: "main,prefill",
    purpose: "onboarding completion and Kimi Code auth start, refresh, and logout",
  },
};

const knownCommands = new Map();
for (const [domain, commands] of Object.entries(commandRegistry)) {
  const metadata = commandDomainMetadata[domain];
  if (!metadata) {
    errors.push(`command domain lacks metadata: ${domain}`);
  } else {
    for (const field of ["owner", "windowCapability", "purpose"]) {
      if (typeof metadata[field] !== "string" || metadata[field].trim() === "") {
        errors.push(`command domain ${domain} lacks ${field}`);
      }
    }
  }

  for (const command of commands) {
    if (knownCommands.has(command)) {
      errors.push(`command ${command} is listed in multiple domains`);
    }
    knownCommands.set(command, { domain, ...metadata });
  }
}

for (const command of registeredCommands) {
  if (!knownCommands.has(command)) {
    errors.push(`registered command has no registry domain: ${command}`);
  }
}

for (const command of knownCommands.keys()) {
  if (!registeredCommands.includes(command)) {
    errors.push(`registry command is not registered: ${command}`);
  }
}

const registeredCommandNames = registeredCommands.map((command) => command.split("::").pop());
const buildCommands = parseRustStringArray(fs.readFileSync(buildPath, "utf8"), "APP_COMMANDS");
const permissionCommands = parsePermissionCommands(fs.readFileSync(permissionPath, "utf8"));
const capabilities = JSON.parse(fs.readFileSync(capabilityPath, "utf8"));
const expectedPermissions = new Map([
  ["main-command-access", registeredCommandNames],
  [
    "prefill-command-access",
    [
      "get_app_status",
      "get_startup_monitor_status",
      "complete_startup_monitor_route",
      "retry_start_backend",
      "open_logs_folder",
      "quit_app_gracefully",
    ],
  ],
  [
    "workspace-import-command-access",
    [
      "list_workspace_import_targets",
      "get_active_workspace_import_request",
      "complete_workspace_import_request",
      "cancel_workspace_import_request",
    ],
  ],
]);

compareSets("build.rs APP_COMMANDS", buildCommands, registeredCommandNames);
for (const [identifier, expected] of expectedPermissions) {
  compareSets(`permission ${identifier}`, permissionCommands.get(identifier) ?? [], expected);
}
requireCapabilityPermission(capabilities, "default", "main-command-access");
requireCapabilityPermission(capabilities, "prefill", "prefill-command-access");
requireCapabilityPermission(
  capabilities,
  "workspace-import-picker",
  "workspace-import-command-access",
);
requireCapabilityPermission(capabilities, "workspace-import-picker", "dialog:allow-open");

const architecture = fs.existsSync(architecturePath)
  ? fs.readFileSync(architecturePath, "utf8")
  : "";
for (const command of commandRegistry.install_compat) {
  const commandName = command.split("::").pop();
  if (!architecture.includes(commandName)) {
    errors.push(`install compat command lacks architecture exit registration: ${command}`);
  }
}
if (!architecture.includes("退出条件")) {
  errors.push("install compat command registration must include an exit condition");
}

if (errors.length > 0) {
  console.error("Command registry check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(
  `Command registry and window ACL check passed (${registeredCommands.length} commands).`,
);

function parseRustStringArray(source, constantName) {
  const match = source.match(
    new RegExp(`const\\s+${constantName}\\s*:[^=]+=[\\s\\S]*?&\\[([\\s\\S]*?)\\];`),
  );
  if (!match) throw new Error(`could not find ${constantName} in build.rs`);
  return [...match[1].matchAll(/"([a-zA-Z_][a-zA-Z0-9_]*)"/g)].map((item) => item[1]);
}

function parsePermissionCommands(source) {
  const permissions = new Map();
  for (const block of source.split("[[permission]]").slice(1)) {
    const identifier = block.match(/identifier\s*=\s*"([^"]+)"/)?.[1];
    const allowed = block.match(/commands\.allow\s*=\s*\[([\s\S]*?)\]/)?.[1];
    if (identifier && allowed != null) {
      permissions.set(
        identifier,
        [...allowed.matchAll(/"([a-zA-Z_][a-zA-Z0-9_]*)"/g)].map((item) => item[1]),
      );
    }
  }
  return permissions;
}

function compareSets(label, actual, expected) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = [...expectedSet].filter((item) => !actualSet.has(item));
  const extra = [...actualSet].filter((item) => !expectedSet.has(item));
  if (actual.length !== actualSet.size) errors.push(`${label} contains duplicate entries`);
  if (missing.length > 0) errors.push(`${label} missing: ${missing.join(", ")}`);
  if (extra.length > 0) errors.push(`${label} has unexpected entries: ${extra.join(", ")}`);
}

function requireCapabilityPermission(capabilities, identifier, permission) {
  const capability = capabilities.capabilities?.find((item) => item.identifier === identifier);
  if (!capability) {
    errors.push(`missing capability: ${identifier}`);
  } else if (!capability.permissions?.includes(permission)) {
    errors.push(`capability ${identifier} is missing permission ${permission}`);
  }
}
