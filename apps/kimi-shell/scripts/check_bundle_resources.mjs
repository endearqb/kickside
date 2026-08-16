import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const configPath = path.resolve(process.cwd(), "src-tauri", "tauri.conf.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const windowsConfigPath = path.resolve(process.cwd(), "src-tauri", "tauri.windows.conf.json");
const windowsConfig = JSON.parse(fs.readFileSync(windowsConfigPath, "utf8"));
const resources = config.bundle?.resources;
const errors = [];

if (!resources || typeof resources !== "object" || Array.isArray(resources)) {
  errors.push("bundle.resources must be an object allowlist");
} else {
  const entries = Object.entries(resources);
  const broadSkills = entries.some(
    ([source, target]) => source === "../../../skills/" || target === "skills/",
  );
  if (broadSkills) {
    errors.push("bundle.resources must not include the whole ../../../skills/ directory");
  }

  for (const [source, target] of entries) {
    if (source.includes("..") && !source.startsWith("../../../skills/")) {
      errors.push(`unexpected parent-directory resource source: ${source}`);
    }
    if (source.startsWith("../../../skills/") && !/^skills\/[^/]+\/$/.test(target)) {
      errors.push(`skill resource target must be a single skill directory: ${target}`);
    }
    const resolved = path.resolve(process.cwd(), "src-tauri", source);
    if (!fs.existsSync(resolved)) {
      errors.push(`resource source does not exist: ${source}`);
    }
  }
}

const installerHooks = windowsConfig.bundle?.windows?.nsis?.installerHooks;
const wixUpgradeCode = windowsConfig.bundle?.windows?.wix?.upgradeCode;
const legacyKimiSidekickUpgradeCode = "dfa197f9-0e61-5393-a612-7e4ca38701cc";
if (wixUpgradeCode !== legacyKimiSidekickUpgradeCode) {
  errors.push(
    `Windows MSI upgradeCode must preserve the pre-KickSide kimi sidekick identity: ${legacyKimiSidekickUpgradeCode}`,
  );
}

if (typeof installerHooks !== "string" || installerHooks.length === 0) {
  errors.push("Windows NSIS installerHooks must be configured for legacy brand migration");
} else {
  const hooksPath = path.resolve(process.cwd(), "src-tauri", installerHooks);
  if (!fs.existsSync(hooksPath)) {
    errors.push(`Windows NSIS installerHooks file does not exist: ${installerHooks}`);
  } else {
    const hooks = fs.readFileSync(hooksPath, "utf8");
    for (const marker of [
      "NSIS_HOOK_PREINSTALL",
      "Uninstall\\Kimi Sidekick",
      '$R8 == "kimi sidekick"',
      "ExecWait '$R0 /P'",
      'msiexec.exe" /x',
      "kickside_legacy_failed",
    ]) {
      if (!hooks.includes(marker)) {
        errors.push(`Windows NSIS legacy migration hook is missing marker: ${marker}`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error("Bundle resource check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Bundle resource check passed.");
