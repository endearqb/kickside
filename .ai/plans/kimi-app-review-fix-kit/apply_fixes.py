#!/usr/bin/env python3
"""Apply or generate the reviewed kimi-app fixes without touching GitHub.

The script is intentionally conservative: it verifies the reviewed base commit by
default and refuses to modify files when an expected source anchor is missing.
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Callable

BASE_COMMIT = "c2aaa14b9891c7de31363610d643ba70fa95c1e4"

PREFILL_COMMANDS = [
    "get_app_status",
    "get_startup_monitor_status",
    "complete_startup_monitor_route",
    "retry_start_backend",
    "open_logs_folder",
    "quit_app_gracefully",
]

WORKSPACE_IMPORT_COMMANDS = [
    "list_workspace_import_targets",
    "get_active_workspace_import_request",
    "complete_workspace_import_request",
    "cancel_workspace_import_request",
]


class FixError(RuntimeError):
    pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate, generate a patch for, or write the reviewed kimi-app fixes."
    )
    parser.add_argument(
        "--repo",
        type=Path,
        default=Path.cwd(),
        help="Path to the kimi-app repository checkout (default: current directory).",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="Write the changes to the checkout. No commit, push, branch, or PR is created.",
    )
    parser.add_argument(
        "--patch-output",
        type=Path,
        help="Write a unified patch generated from the checkout's exact current files.",
    )
    parser.add_argument(
        "--show-diff",
        action="store_true",
        help="Print the generated unified diff to stdout.",
    )
    parser.add_argument(
        "--allow-other-revision",
        action="store_true",
        help="Allow a checkout whose HEAD differs from the reviewed base commit.",
    )
    return parser.parse_args()


def run_git(repo: Path, *args: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(repo), *args],
            check=True,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None
    return result.stdout.strip()


def verify_revision(repo: Path, allow_other_revision: bool) -> None:
    revision = run_git(repo, "rev-parse", "HEAD")
    if revision is None:
        if allow_other_revision:
            print("warning: unable to read Git HEAD; continuing because --allow-other-revision was set")
            return
        raise FixError(
            "The target is not a readable Git checkout. Pass --allow-other-revision only after "
            "manually confirming the source matches the reviewed revision."
        )
    if revision != BASE_COMMIT and not allow_other_revision:
        raise FixError(
            f"HEAD is {revision}, but this kit reviewed {BASE_COMMIT}. "
            "Rebase/adapt the fixes manually or pass --allow-other-revision after reviewing the diff."
        )


def read_required(repo: Path, relative_path: str) -> str:
    path = repo / relative_path
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError as error:
        raise FixError(f"Required file is missing: {relative_path}") from error


def replace_once(text: str, old: str, new: str, relative_path: str) -> str:
    old_count = text.count(old)
    new_count = text.count(new)
    if new_count == 1 and old_count == new.count(old):
        return text
    if new_count != 0 or old_count != 1:
        raise FixError(
            f"Expected one unchanged or one already-fixed source anchor in {relative_path}; "
            f"found old={old_count}, new={new_count}. The file may be partially modified "
            "or may have changed since review."
        )
    return text.replace(old, new, 1)


def replace_n(text: str, old: str, new: str, expected: int, relative_path: str) -> str:
    old_count = text.count(old)
    new_count = text.count(new)
    if new_count == expected and old_count == expected * new.count(old):
        return text
    if new_count != 0 or old_count != expected:
        raise FixError(
            f"Expected {expected} unchanged or already-fixed source anchors in {relative_path}; "
            f"found old={old_count}, new={new_count}. The file may be partially modified "
            "or may have changed since review."
        )
    return text.replace(old, new)


def parse_registered_commands(source: str) -> list[str]:
    match = re.search(r"tauri::generate_handler!\[(.*?)\]\s*\n", source, re.DOTALL)
    if not match:
        raise FixError("Unable to parse tauri::generate_handler! in src-tauri/src/commands.rs")
    body = re.sub(r"//.*", "", match.group(1))
    commands: list[str] = []
    for raw in body.split(","):
        token = raw.strip()
        if not token:
            continue
        name = token.split("::")[-1].strip()
        if not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_]*", name):
            raise FixError(f"Unexpected command token in commands.rs: {token!r}")
        commands.append(name)
    duplicates = sorted({name for name in commands if commands.count(name) > 1})
    if duplicates:
        raise FixError(f"Duplicate Tauri command basenames: {', '.join(duplicates)}")
    for required in [*PREFILL_COMMANDS, *WORKSPACE_IMPORT_COMMANDS]:
        if required not in commands:
            raise FixError(f"Required command is not registered: {required}")
    return commands


def render_build_rs(commands: list[str]) -> str:
    command_lines = "\n".join(f'    "{command}",' for command in commands)
    return f'''const APP_COMMANDS: &[&str] = &[\n{command_lines}\n];\n\nfn main() {{\n    tauri_build::try_build(\n        tauri_build::Attributes::new()\n            .app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS)),\n    )\n    .expect("failed to build Tauri application manifest");\n}}\n'''


def render_permission_toml(commands: list[str]) -> str:
    def block(identifier: str, description: str, allowed: list[str]) -> str:
        command_lines = "\n".join(f'  "{command}",' for command in allowed)
        return f'''[[permission]]\nidentifier = "{identifier}"\ndescription = "{description}"\ncommands.allow = [\n{command_lines}\n]\n'''

    return (
        "# Command access is explicit so lower-privilege windows do not inherit every app command.\n"
        "# scripts/check_command_permissions.mjs verifies this file against commands.rs and build.rs.\n\n"
        + block(
            "main-command-access",
            "Allows the main application window to use the complete registered command surface.",
            commands,
        )
        + "\n"
        + block(
            "prefill-command-access",
            "Allows only startup-monitor and recovery commands required by the prefill window.",
            PREFILL_COMMANDS,
        )
        + "\n"
        + block(
            "workspace-import-command-access",
            "Allows only workspace import request commands required by the standalone picker.",
            WORKSPACE_IMPORT_COMMANDS,
        )
    )


def render_command_permission_checker() -> str:
    prefill = json.dumps(PREFILL_COMMANDS, indent=2)
    picker = json.dumps(WORKSPACE_IMPORT_COMMANDS, indent=2)
    return f'''import fs from "node:fs";\nimport path from "node:path";\nimport process from "node:process";\nimport {{ fileURLToPath }} from "node:url";\n\nconst scriptDir = path.dirname(fileURLToPath(import.meta.url));\nconst rootDir = path.resolve(scriptDir, "..");\nconst errors = [];\n\nconst commandsSource = fs.readFileSync(\n  path.join(rootDir, "src-tauri", "src", "commands.rs"),\n  "utf8",\n);\nconst buildSource = fs.readFileSync(path.join(rootDir, "src-tauri", "build.rs"), "utf8");\nconst permissionSource = fs.readFileSync(\n  path.join(rootDir, "src-tauri", "permissions", "command-access.toml"),\n  "utf8",\n);\nconst capabilities = JSON.parse(\n  fs.readFileSync(path.join(rootDir, "src-tauri", "capabilities", "default.json"), "utf8"),\n);\n\nconst registeredCommands = parseRegisteredCommands(commandsSource);\nconst buildCommands = parseRustStringArray(buildSource, "APP_COMMANDS");\nconst permissionCommands = parsePermissionCommands(permissionSource);\n\nconst expectedPermissions = new Map([\n  ["main-command-access", registeredCommands],\n  ["prefill-command-access", {prefill}],\n  ["workspace-import-command-access", {picker}],\n]);\n\ncompareSets("build.rs APP_COMMANDS", buildCommands, registeredCommands);\nfor (const [identifier, expected] of expectedPermissions) {{\n  compareSets(\n    `permission ${{identifier}}`,\n    permissionCommands.get(identifier) ?? [],\n    expected,\n  );\n}}\n\nrequireCapabilityPermission("default", "main-command-access");\nrequireCapabilityPermission("prefill", "prefill-command-access");\nrequireCapabilityPermission("workspace-import-picker", "workspace-import-command-access");\nrequireCapabilityPermission("workspace-import-picker", "dialog:allow-open");\n\nif (errors.length > 0) {{\n  for (const error of errors) console.error(`- ${{error}}`);\n  process.exit(1);\n}}\nconsole.log(\n  `Tauri command permissions verified: ${{registeredCommands.length}} registered commands; ` +\n    "main/prefill/workspace-import ACLs are synchronized.",\n);\n\nfunction parseRegisteredCommands(source) {{\n  const match = source.match(/tauri::generate_handler!\\[([\\s\\S]*?)\\]\\s*\\n/);\n  if (!match) throw new Error("Unable to parse tauri::generate_handler!");\n  const commands = match[1]\n    .replace(/\\/\\/.*$/gm, "")\n    .split(",")\n    .map((entry) => entry.trim())\n    .filter(Boolean)\n    .map((entry) => entry.split("::").at(-1));\n  const duplicates = commands.filter((command, index) => commands.indexOf(command) !== index);\n  if (duplicates.length > 0) {{\n    errors.push(`duplicate registered command basenames: ${{[...new Set(duplicates)].join(", ")}}`);\n  }}\n  return commands;\n}}\n\nfunction parseRustStringArray(source, constantName) {{\n  const expression = new RegExp(\n    `const\\\\s+${{constantName}}\\\\s*:[^=]+=[\\\\s\\\\S]*?&\\\\[([\\\\s\\\\S]*?)\\\\];`,\n  );\n  const match = source.match(expression);\n  if (!match) throw new Error(`Unable to parse ${{constantName}} from build.rs`);\n  return [...match[1].matchAll(/"([a-zA-Z_][a-zA-Z0-9_]*)"/g)].map((item) => item[1]);\n}}\n\nfunction parsePermissionCommands(source) {{\n  const result = new Map();\n  for (const block of source.split("[[permission]]").slice(1)) {{\n    const identifier = block.match(/identifier\\s*=\\s*"([^"]+)"/)?.[1];\n    const allowed = block.match(/commands\\.allow\\s*=\\s*\\[([\\s\\S]*?)\\]/)?.[1];\n    if (!identifier || allowed == null) continue;\n    result.set(\n      identifier,\n      [...allowed.matchAll(/"([a-zA-Z_][a-zA-Z0-9_]*)"/g)].map((item) => item[1]),\n    );\n  }}\n  return result;\n}}\n\nfunction compareSets(label, actual, expected) {{\n  const actualSet = new Set(actual);\n  const expectedSet = new Set(expected);\n  const missing = [...expectedSet].filter((item) => !actualSet.has(item));\n  const extra = [...actualSet].filter((item) => !expectedSet.has(item));\n  if (actual.length !== actualSet.size) {{\n    errors.push(`${{label}} contains duplicate entries`);\n  }}\n  if (missing.length > 0) errors.push(`${{label}} missing: ${{missing.join(", ")}}`);\n  if (extra.length > 0) errors.push(`${{label}} has unexpected entries: ${{extra.join(", ")}}`);\n}}\n\nfunction requireCapabilityPermission(identifier, permission) {{\n  const capability = capabilities.capabilities?.find((item) => item.identifier === identifier);\n  if (!capability) {{\n    errors.push(`missing capability: ${{identifier}}`);\n    return;\n  }}\n  if (!capability.permissions?.includes(permission)) {{\n    errors.push(`capability ${{identifier}} is missing permission ${{permission}}`);\n  }}\n}}\n'''


def transform_capabilities(text: str) -> str:
    path = "apps/kimi-shell/src-tauri/capabilities/default.json"
    text = replace_once(
        text,
        '''        "core:webview:allow-webview-close",\n        "dialog:allow-open"''',
        '''        "core:webview:allow-webview-close",\n        "dialog:allow-open",\n        "main-command-access"''',
        path,
    )
    text = replace_once(
        text,
        '''      "windows": ["prefill"],\n      "permissions": ["core:default"]''',
        '''      "windows": ["prefill"],\n      "permissions": ["core:default", "prefill-command-access"]''',
        path,
    )
    text = replace_once(
        text,
        '''      "windows": ["workspace-import-picker"],\n      "permissions": ["core:default"]''',
        '''      "windows": ["workspace-import-picker"],\n      "permissions": [\n        "core:default",\n        "dialog:allow-open",\n        "workspace-import-command-access"\n      ]''',
        path,
    )
    return text


def transform_install_controller(text: str) -> str:
    path = "apps/kimi-shell/src/app/useInstallController.ts"
    text = replace_once(
        text,
        '''type UseInstallControllerOptions = {\n  tauriRuntime: boolean;''',
        '''type UseInstallControllerOptions = {\n  tauriRuntime: boolean;\n  enabled: boolean;''',
        path,
    )
    text = replace_once(
        text,
        '''export function useInstallController({\n  tauriRuntime,\n  refreshOnboarding,''',
        '''export function useInstallController({\n  tauriRuntime,\n  enabled,\n  refreshOnboarding,''',
        path,
    )
    text = replace_once(
        text,
        '''  useEffect(() => {\n    if (!tauriRuntime) {\n      return;\n    }''',
        '''  useEffect(() => {\n    if (!tauriRuntime || !enabled) {\n      return;\n    }''',
        path,
    )
    text = replace_once(
        text,
        '''  }, [setActionError, tauriRuntime]);''',
        '''  }, [enabled, setActionError, tauriRuntime]);''',
        path,
    )
    return text


def transform_shell_polling(text: str) -> str:
    path = "apps/kimi-shell/src/app/useShellPollingController.ts"
    text = replace_once(
        text,
        '''type ShellPollingControllerOptions = PollingCallbacks & {\n  tauriRuntime: boolean;''',
        '''type ShellPollingControllerOptions = PollingCallbacks & {\n  tauriRuntime: boolean;\n  enabled: boolean;''',
        path,
    )
    text = replace_once(
        text,
        '''  const {\n    tauriRuntime,\n    screen,''',
        '''  const {\n    tauriRuntime,\n    enabled,\n    screen,''',
        path,
    )
    text = replace_once(
        text,
        '''  useEffect(() => {\n    const callbacks = callbacksRef.current;''',
        '''  useEffect(() => {\n    if (!enabled) {\n      return;\n    }\n    const callbacks = callbacksRef.current;''',
        path,
    )
    text = replace_once(
        text,
        '''  }, [controlCenterModalOpen, screen, tauriRuntime]);''',
        '''  }, [controlCenterModalOpen, enabled, screen, tauriRuntime]);''',
        path,
    )
    text = replace_n(
        text,
        '''  useEffect(() => {\n    const controlCenterVisible = screen === "control_center" || controlCenterModalOpen;''',
        '''  useEffect(() => {\n    if (!enabled) {\n      return;\n    }\n    const controlCenterVisible = screen === "control_center" || controlCenterModalOpen;''',
        2,
        path,
    )
    text = replace_once(
        text,
        '''    activeRuntimePanel,\n    controlCenterModalOpen,\n    screen,\n  ]);''',
        '''    activeRuntimePanel,\n    controlCenterModalOpen,\n    enabled,\n    screen,\n  ]);''',
        path,
    )
    text = replace_once(
        text,
        '''    bridgeState,\n    controlCenterModalOpen,\n    screen,\n  ]);''',
        '''    bridgeState,\n    controlCenterModalOpen,\n    enabled,\n    screen,\n  ]);''',
        path,
    )
    return text


def transform_shell_controller(text: str) -> str:
    path = "apps/kimi-shell/src/app/useShellController.ts"
    text = replace_once(
        text,
        '''  const tauriRuntime = useMemo(() => isTauri(), []);\n  const {''',
        '''  const tauriRuntime = useMemo(() => isTauri(), []);\n  const skipShellBackgroundControllers =\n    parseHashRoute(routeHash) === "workspace-import-picker";\n  const {''',
        path,
    )
    text = replace_once(
        text,
        '''  } = useInstallController({\n    tauriRuntime,\n    refreshOnboarding,''',
        '''  } = useInstallController({\n    tauriRuntime,\n    enabled: !skipShellBackgroundControllers,\n    refreshOnboarding,''',
        path,
    )
    text = replace_once(
        text,
        '''  useShellPollingController({\n    tauriRuntime,''',
        '''  useShellPollingController({\n    tauriRuntime,\n    enabled: !isWorkspaceImportPickerRoute,''',
        path,
    )
    text = replace_once(
        text,
        '''  useEffect(() => {\n    void refreshActiveSessionSkills();\n  }, [status?.activeSessionId, status?.activeSessionWorkDir]);''',
        '''  useEffect(() => {\n    if (isWorkspaceImportPickerRoute) {\n      return;\n    }\n    void refreshActiveSessionSkills();\n  }, [isWorkspaceImportPickerRoute, status?.activeSessionId, status?.activeSessionWorkDir]);''',
        path,
    )
    text = replace_once(
        text,
        '''  useEffect(() => {\n    if (!status) return;\n    if (status.state !== "starting") return;\n    if (loadingReportCycleRef.current === status.startCycleId) return;''',
        '''  useEffect(() => {\n    if (isWorkspaceImportPickerRoute || !status) return;\n    if (status.state !== "starting") return;\n    if (loadingReportCycleRef.current === status.startCycleId) return;''',
        path,
    )
    text = replace_once(
        text,
        '''  }, [status]);\n\n  async function handleRetry() {''',
        '''  }, [isWorkspaceImportPickerRoute, status]);\n\n  async function handleRetry() {''',
        path,
    )
    return text

def transform_workspace_import_controller(text: str) -> str:
    path = "apps/kimi-shell/src/app/useWorkspaceImportController.ts"
    return replace_n(
        text,
        '''      await refreshStatus();''',
        '''      if (!isWorkspaceImportPickerRoute) {\n        await refreshStatus();\n      }''',
        2,
        path,
    )


def transform_bridge_app(text: str) -> str:
    path = "apps/kimi-im-bridge/internal/app/app.go"
    text = replace_once(
        text,
        '''\tmu            sync.RWMutex\n\tstate         domain.BridgeRuntimeState''',
        '''\tlifecycleMu   sync.Mutex\n\tmu            sync.RWMutex\n\tstate         domain.BridgeRuntimeState''',
        path,
    )
    text = replace_once(
        text,
        '''func (s *Service) Start() error {\n\ts.mu.Lock()''',
        '''func (s *Service) Start() error {\n\ts.lifecycleMu.Lock()\n\tdefer s.lifecycleMu.Unlock()\n\n\ts.mu.Lock()''',
        path,
    )
    text = replace_once(
        text,
        '''func (s *Service) Shutdown(ctx context.Context) error {\n\ts.mu.Lock()''',
        '''func (s *Service) Shutdown(ctx context.Context) error {\n\ts.lifecycleMu.Lock()\n\tdefer s.lifecycleMu.Unlock()\n\n\ts.mu.Lock()''',
        path,
    )
    return text


def transform_bridge_app_test(text: str) -> str:
    path = "apps/kimi-im-bridge/internal/app/app_test.go"
    text = replace_once(
        text,
        '''import (\n\t"context"\n\t"os"\n\t"path/filepath"\n\t"strings"\n\t"testing"''',
        '''import (\n\t"context"\n\t"net"\n\t"os"\n\t"path/filepath"\n\t"strings"\n\t"sync"\n\t"testing"''',
        path,
    )
    marker = "func TestStartSerializesConcurrentLifecycleRequests"
    if marker in text:
        return text
    addition = r'''

func TestStartSerializesConcurrentLifecycleRequests(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	service, err := New(Options{
		Version:     "test",
		ConfigPath:  filepath.Join(dir, "bridge_settings.json"),
		SecretsPath: filepath.Join(dir, "bridge_secrets.json"),
		DBPath:      filepath.Join(dir, "bridge.db"),
		LogFilePath: filepath.Join(dir, "logs", "bridge.log"),
		AdminPort:   reserveTCPPort(t),
		AdminToken:  "token-1",
	})
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}
	defer service.Close()

	const workers = 24
	start := make(chan struct{})
	errors := make(chan error, workers)
	var waitGroup sync.WaitGroup
	waitGroup.Add(workers)
	for worker := 0; worker < workers; worker++ {
		go func() {
			defer waitGroup.Done()
			<-start
			errors <- service.Start()
		}()
	}

	close(start)
	waitGroup.Wait()
	close(errors)
	for startError := range errors {
		if startError != nil {
			t.Fatalf("concurrent Start returned error: %v", startError)
		}
	}

	status, err := service.Status(context.Background())
	if err != nil {
		t.Fatalf("Status returned error: %v", err)
	}
	if status.State != domain.BridgeStateRunning {
		t.Fatalf("expected running state after concurrent Start calls, got %+v", status)
	}
}

func reserveTCPPort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve TCP port: %v", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	if err := listener.Close(); err != nil {
		t.Fatalf("release reserved TCP port: %v", err)
	}
	return port
}
'''
    return text.rstrip() + addition


def transform_admin_server(text: str) -> str:
    path = "apps/kimi-im-bridge/internal/admin/server.go"
    text = replace_once(
        text,
        '''\t"fmt"\n\t"net/http"''',
        '''\t"fmt"\n\t"io"\n\t"net/http"''',
        path,
    )
    text = replace_once(
        text,
        '''func decodeAdminJSON(writer http.ResponseWriter, request *http.Request, target any, maxBytes int64) bool {\n\trequest.Body = http.MaxBytesReader(writer, request.Body, maxBytes)\n\tif err := json.NewDecoder(request.Body).Decode(target); err != nil {\n\t\tvar maxBytesError *http.MaxBytesError\n\t\tif errors.As(err, &maxBytesError) {\n\t\t\twriteAdminError(writer, request, http.StatusRequestEntityTooLarge, "body_too_large", "request body too large", nil)\n\t\t\treturn false\n\t\t}\n\t\twriteAdminError(writer, request, http.StatusBadRequest, "invalid_json", "invalid JSON request body", nil)\n\t\treturn false\n\t}\n\treturn true\n}''',
        '''func decodeAdminJSON(writer http.ResponseWriter, request *http.Request, target any, maxBytes int64) bool {\n\trequest.Body = http.MaxBytesReader(writer, request.Body, maxBytes)\n\tdecoder := json.NewDecoder(request.Body)\n\tif err := decoder.Decode(target); err != nil {\n\t\tvar maxBytesError *http.MaxBytesError\n\t\tif errors.As(err, &maxBytesError) {\n\t\t\twriteAdminError(writer, request, http.StatusRequestEntityTooLarge, "body_too_large", "request body too large", nil)\n\t\t\treturn false\n\t\t}\n\t\twriteAdminError(writer, request, http.StatusBadRequest, "invalid_json", "invalid JSON request body", nil)\n\t\treturn false\n\t}\n\n\tvar trailing json.RawMessage\n\tif err := decoder.Decode(&trailing); err != io.EOF {\n\t\tif err != nil {\n\t\t\tvar maxBytesError *http.MaxBytesError\n\t\t\tif errors.As(err, &maxBytesError) {\n\t\t\t\twriteAdminError(writer, request, http.StatusRequestEntityTooLarge, "body_too_large", "request body too large", nil)\n\t\t\t\treturn false\n\t\t\t}\n\t\t}\n\t\twriteAdminError(writer, request, http.StatusBadRequest, "invalid_json", "request body must contain exactly one JSON value", nil)\n\t\treturn false\n\t}\n\treturn true\n}''',
        path,
    )
    return text


def transform_admin_server_test(text: str) -> str:
    marker = "func TestAdminJSONRejectsTrailingValue"
    if marker in text:
        return text
    path = "apps/kimi-im-bridge/internal/admin/server_test.go"
    anchor = '''func TestApprovalsAndRuntimeStopEndpoints(t *testing.T) {'''
    if anchor not in text:
        raise FixError(f"Expected insertion anchor is missing in {path}")
    addition = r'''func TestAdminJSONRejectsTrailingValue(t *testing.T) {
	t.Parallel()

	fake := &fakeService{}
	server := httptest.NewServer(NewHandler(fake, "token-1"))
	defer server.Close()

	request, _ := http.NewRequest(
		http.MethodPost,
		server.URL+"/api/v1/sessions/import",
		strings.NewReader(`{"source":"shell-web","sourceSessionId":"web-1","workDir":"D:/repo"}{"workDir":"D:/other"}`),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Bridge-Admin-Token", "token-1")

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("trailing JSON request returned error: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for multiple JSON values, got %d", response.StatusCode)
	}
	if len(fake.imported) != 0 {
		t.Fatalf("expected invalid request not to reach service, got %+v", fake.imported)
	}
}

'''
    return text.replace(anchor, addition + anchor, 1)


def transform_pane_frame(text: str) -> str:
    path = "apps/kimi-shell/src/features/workspace-grid/PaneFrame.tsx"
    text = replace_once(
        text,
        '''  const embeddedControllerRef =\n    useRef<EmbeddedExternalWebviewController | null>(null);\n  const [externalState, setExternalState] =''',
        '''  const embeddedControllerRef =\n    useRef<EmbeddedExternalWebviewController | null>(null);\n  const embeddedOpenGenerationRef = useRef(0);\n  const [externalState, setExternalState] =''',
        path,
    )
    text = replace_once(
        text,
        '''    setEmbeddedStatus("idle");\n    setEmbeddedError("");\n    return () => {\n      void closeEmbeddedController(embeddedControllerRef).catch(() => undefined);\n    };''',
        '''    setEmbeddedStatus("idle");\n    setEmbeddedError("");\n    return () => {\n      embeddedOpenGenerationRef.current += 1;\n      void closeEmbeddedController(embeddedControllerRef).catch(() => undefined);\n    };''',
        path,
    )
    text = replace_once(
        text,
        '''    void closeEmbeddedController(embeddedControllerRef)\n      .then(() => setEmbeddedStatus("idle"))''',
        '''    embeddedOpenGenerationRef.current += 1;\n    void closeEmbeddedController(embeddedControllerRef)\n      .then(() => setEmbeddedStatus("idle"))''',
        path,
    )
    text = replace_once(
        text,
        '''  async function handleOpenEmbeddedWebview() {\n    const host = embedHostRef.current;\n    if (!host || !sourceUrl) {\n      return;\n    }\n\n    setEmbeddedStatus("opening");\n    setEmbeddedError("");\n\n    try {\n      await closeEmbeddedController(embeddedControllerRef);\n      embeddedControllerRef.current = await createEmbeddedExternalWebview({\n        url: sourceUrl,\n        title: source.title,\n        bounds: rectToEmbeddedBounds(host.getBoundingClientRect()),\n        storageNamespace: pane.storageNamespace,\n      });\n      setExternalState("ready");\n      setEmbeddedStatus("active");\n    } catch (error) {\n      setEmbeddedStatus("failed");\n      setEmbeddedError(`嵌入式 Webview 打开失败：${formatError(error)}`);\n    }\n  }''',
        '''  async function handleOpenEmbeddedWebview() {\n    const host = embedHostRef.current;\n    if (!host || !sourceUrl) {\n      return;\n    }\n\n    const openGeneration = embeddedOpenGenerationRef.current + 1;\n    embeddedOpenGenerationRef.current = openGeneration;\n    setEmbeddedStatus("opening");\n    setEmbeddedError("");\n\n    let controller: EmbeddedExternalWebviewController | null = null;\n    try {\n      await closeEmbeddedController(embeddedControllerRef);\n      if (embeddedOpenGenerationRef.current !== openGeneration) {\n        return;\n      }\n\n      controller = await createEmbeddedExternalWebview({\n        url: sourceUrl,\n        title: source.title,\n        bounds: rectToEmbeddedBounds(host.getBoundingClientRect()),\n        storageNamespace: pane.storageNamespace,\n      });\n      if (embeddedOpenGenerationRef.current !== openGeneration) {\n        await controller.close().catch(() => undefined);\n        return;\n      }\n\n      embeddedControllerRef.current = controller;\n      setExternalState("ready");\n      setEmbeddedStatus("active");\n    } catch (error) {\n      if (embeddedOpenGenerationRef.current !== openGeneration) {\n        await controller?.close().catch(() => undefined);\n        return;\n      }\n      setEmbeddedStatus("failed");\n      setEmbeddedError(`嵌入式 Webview 打开失败：${formatError(error)}`);\n    }\n  }''',
        path,
    )
    return text


def transform_workspace_grid_test(text: str) -> str:
    marker = "closes a child webview that resolves after its pane is removed"
    if marker in text:
        return text
    path = "apps/kimi-shell/src/features/workspace-grid/WorkspaceGridView.test.tsx"
    anchor = '''  });\n});\n\nfunction pointerEvent'''
    if anchor not in text:
        raise FixError(f"Expected test insertion anchor is missing in {path}")
    addition = '''  });\n\n  it("closes a child webview that resolves after its pane is removed", async () => {\n    vi.useFakeTimers();\n    const externalPane = addExternalPaneToGrid();\n    const controller = {\n      close: vi.fn(async () => undefined),\n      sync: vi.fn(async () => undefined),\n    };\n    const creation = deferred<typeof controller>();\n    vi.mocked(createEmbeddedExternalWebview).mockReturnValueOnce(creation.promise);\n    render(<WorkspaceGridView {...props} />);\n\n    act(() => {\n      vi.advanceTimersByTime(8_000);\n    });\n    await act(async () => {\n      fireEvent.click(screen.getByRole("button", { name: "在窗格内打开" }));\n      await Promise.resolve();\n    });\n    expect(createEmbeddedExternalWebview).toHaveBeenCalledTimes(1);\n    act(() => {\n      useWorkspaceGridStore.getState().removePane(externalPane.id);\n    });\n\n    await act(async () => {\n      creation.resolve(controller);\n      await Promise.resolve();\n      await Promise.resolve();\n    });\n\n    expect(controller.close).toHaveBeenCalledTimes(1);\n  });\n});\n\nfunction pointerEvent'''
    text = text.replace(anchor, addition, 1)
    helper_anchor = '''function addExternalPaneToGrid() {'''
    helper = '''function deferred<T>() {\n  let resolve!: (value: T | PromiseLike<T>) => void;\n  const promise = new Promise<T>((nextResolve) => {\n    resolve = nextResolve;\n  });\n  return { promise, resolve };\n}\n\n'''
    if helper_anchor not in text:
        raise FixError(f"Expected helper insertion anchor is missing in {path}")
    return text.replace(helper_anchor, helper + helper_anchor, 1)


def transform_package_json(text: str) -> str:
    path = "apps/kimi-shell/package.json"
    return replace_once(
        text,
        '''    "check:nfr:security": "node scripts/check_capabilities.mjs && node scripts/check_bundle_resources.mjs && node scripts/check_command_registry.mjs",''',
        '''    "check:nfr:security": "node scripts/check_capabilities.mjs && node scripts/check_bundle_resources.mjs && node scripts/check_command_registry.mjs && node scripts/check_command_permissions.mjs",''',
        path,
    )


def build_changes(repo: Path) -> tuple[dict[str, str], dict[str, str]]:
    commands_path = "apps/kimi-shell/src-tauri/src/commands.rs"
    commands_source = read_required(repo, commands_path)
    commands = parse_registered_commands(commands_source)

    transforms: dict[str, Callable[[str], str]] = {
        "apps/kimi-shell/src-tauri/capabilities/default.json": transform_capabilities,
        "apps/kimi-shell/src/app/useInstallController.ts": transform_install_controller,
        "apps/kimi-shell/src/app/useShellPollingController.ts": transform_shell_polling,
        "apps/kimi-shell/src/app/useShellController.ts": transform_shell_controller,
        "apps/kimi-shell/src/app/useWorkspaceImportController.ts": transform_workspace_import_controller,
        "apps/kimi-im-bridge/internal/app/app.go": transform_bridge_app,
        "apps/kimi-im-bridge/internal/app/app_test.go": transform_bridge_app_test,
        "apps/kimi-im-bridge/internal/admin/server.go": transform_admin_server,
        "apps/kimi-im-bridge/internal/admin/server_test.go": transform_admin_server_test,
        "apps/kimi-shell/src/features/workspace-grid/PaneFrame.tsx": transform_pane_frame,
        "apps/kimi-shell/src/features/workspace-grid/WorkspaceGridView.test.tsx": transform_workspace_grid_test,
        "apps/kimi-shell/package.json": transform_package_json,
    }

    originals: dict[str, str] = {}
    updated: dict[str, str] = {}
    for relative_path, transform in transforms.items():
        original = read_required(repo, relative_path)
        originals[relative_path] = original
        updated[relative_path] = transform(original)

    generated_files = {
        "apps/kimi-shell/src-tauri/build.rs": render_build_rs(commands),
        "apps/kimi-shell/src-tauri/permissions/command-access.toml": render_permission_toml(commands),
        "apps/kimi-shell/scripts/check_command_permissions.mjs": render_command_permission_checker(),
    }
    for relative_path, desired in generated_files.items():
        path = repo / relative_path
        original = path.read_text(encoding="utf-8") if path.exists() else ""
        if relative_path.endswith("build.rs"):
            known_original = "fn main() {\n    tauri_build::build()\n}\n"
            if original not in (known_original, desired):
                raise FixError(
                    f"Unexpected existing content in {relative_path}; refusing to overwrite it."
                )
        elif original and original != desired:
            raise FixError(
                f"Unexpected existing content in {relative_path}; refusing to overwrite it."
            )
        originals[relative_path] = original
        updated[relative_path] = desired

    return originals, updated


def make_patch(originals: dict[str, str], updated: dict[str, str]) -> str:
    sections: list[str] = []
    for relative_path in sorted(updated):
        old = originals[relative_path]
        new = updated[relative_path]
        if old == new:
            continue
        sections.append(f"diff --git a/{relative_path} b/{relative_path}")
        if old == "":
            sections.append("new file mode 100644")
        from_file = f"a/{relative_path}" if old else "/dev/null"
        to_file = f"b/{relative_path}"
        sections.extend(
            difflib.unified_diff(
                old.splitlines(),
                new.splitlines(),
                fromfile=from_file,
                tofile=to_file,
                lineterm="",
                n=3,
            )
        )
    return "\n".join(sections) + ("\n" if sections else "")


def write_changes(repo: Path, originals: dict[str, str], updated: dict[str, str]) -> list[str]:
    changed: list[str] = []
    for relative_path, new in updated.items():
        if originals[relative_path] == new:
            continue
        path = repo / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(new, encoding="utf-8", newline="\n")
        changed.append(relative_path)
    return sorted(changed)


def main() -> int:
    args = parse_args()
    repo = args.repo.resolve()
    try:
        verify_revision(repo, args.allow_other_revision)
        originals, updated = build_changes(repo)
        patch = make_patch(originals, updated)
    except FixError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2

    changed = sorted(path for path in updated if originals[path] != updated[path])
    if not changed:
        print("All reviewed fixes are already present.")
        return 0

    print(f"Validated {len(changed)} file changes against the checkout:")
    for relative_path in changed:
        print(f"  - {relative_path}")

    if args.patch_output:
        output = args.patch_output.resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(patch, encoding="utf-8", newline="\n")
        print(f"Patch written to: {output}")

    if args.show_diff:
        print(patch, end="")

    if args.write:
        written = write_changes(repo, originals, updated)
        print(f"Wrote {len(written)} files. No Git commit, push, branch, or PR was created.")
    else:
        print("Check-only mode: no repository files were modified.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
