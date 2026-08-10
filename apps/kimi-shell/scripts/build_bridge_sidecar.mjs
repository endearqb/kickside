import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const shellRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(shellRoot, "..", "..");
const bridgeRoot = path.join(repoRoot, "apps", "kimi-im-bridge");
const outputDir = path.join(shellRoot, "src-tauri", "binaries");

const targetMappings = new Map([
  [
    "aarch64-apple-darwin",
    {
      goos: "darwin",
      goarch: "arm64",
      extension: "",
      hostPlatform: "darwin",
      hostArch: "arm64",
    },
  ],
  [
    "x86_64-pc-windows-msvc",
    {
      goos: "windows",
      goarch: "amd64",
      extension: ".exe",
      hostPlatform: "win32",
      hostArch: "x64",
    },
  ],
]);
const hostTargets = new Map([
  ["darwin-arm64", "aarch64-apple-darwin"],
  ["win32-x64", "x86_64-pc-windows-msvc"],
]);

function readOption(name, fallback) {
  const inlinePrefix = `${name}=`;
  const inline = process.argv.slice(2).find((argument) => argument.startsWith(inlinePrefix));
  if (inline) {
    return inline.slice(inlinePrefix.length);
  }

  const index = process.argv.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? bridgeRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });

  if (result.error) {
    throw new Error(`failed to run ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = options.capture ? `: ${(result.stderr || result.stdout).trim()}` : "";
    throw new Error(`${command} exited with code ${result.status ?? "unknown"}${detail}`);
  }
  return result;
}

const explicitTarget = readOption("--target", "");
const tauriTarget = String(process.env.TAURI_ENV_TARGET_TRIPLE ?? "").trim();
const hostTarget = hostTargets.get(`${process.platform}-${process.arch}`) ?? "";
const target = explicitTarget || tauriTarget || hostTarget;
const targetSource = explicitTarget ? "argument" : tauriTarget ? "tauri_env" : "host";
const profile = readOption("--profile", "release");
if (!targetMappings.has(target)) {
  throw new Error(
    `unsupported target ${JSON.stringify(target)} from ${targetSource}; expected one of ${[
      ...targetMappings.keys(),
    ].join(", ")}`,
  );
}
if (!new Set(["debug", "release"]).has(profile)) {
  throw new Error(`unsupported --profile ${JSON.stringify(profile)}; expected debug or release`);
}

const mapping = targetMappings.get(target);
const outputPath = path.join(outputDir, `kimi-im-bridge-${target}${mapping.extension}`);
mkdirSync(outputDir, { recursive: true });

const buildArgs = ["build", "-trimpath"];
if (profile === "release") {
  buildArgs.push("-ldflags=-s -w");
}
buildArgs.push("-o", outputPath, "./cmd/kimi-im-bridge");

run("go", buildArgs, {
  env: {
    ...process.env,
    CGO_ENABLED: "0",
    GOOS: mapping.goos,
    GOARCH: mapping.goarch,
  },
});

if (mapping.goos !== "windows") {
  chmodSync(outputPath, 0o755);
}

if (process.platform === mapping.hostPlatform && process.arch === mapping.hostArch) {
  const versionResult = run(outputPath, ["--version"], { capture: true });
  const versionLine = versionResult.stdout.trim();
  if (!/^kimi-im-bridge\s+\S+$/.test(versionLine)) {
    throw new Error(`unexpected bridge --version output: ${JSON.stringify(versionLine)}`);
  }
  console.log(`[build:bridge-sidecar] version=${versionLine}`);
} else {
  console.log(
    `[build:bridge-sidecar] skipped executable smoke for foreign target=${target} host=${process.platform}-${process.arch}`,
  );
}

console.log(
  `[build:bridge-sidecar] target=${target} target_source=${targetSource} profile=${profile} cgo=0 output=${outputPath}`,
);
