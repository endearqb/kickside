import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const packageJsonPath = path.join(projectRoot, "package.json");
const syncVersionScriptPath = path.join(__dirname, "sync_version.mjs");

const isDryRun = process.argv.includes("--dry-run");
const packageJsonRaw = fs.readFileSync(packageJsonPath, "utf8");
const packageJson = JSON.parse(packageJsonRaw);
const currentVersion = String(packageJson.version || "").trim();

if (!/^\d+\.\d+\.\d+$/.test(currentVersion)) {
  throw new Error(`Invalid package.json version: ${currentVersion}`);
}

const [major, minor, patch] = currentVersion.split(".").map((part) => Number(part));
const nextVersion = `${major}.${minor}.${patch + 1}`;

if (isDryRun) {
  console.log(`[bump:patch] ${currentVersion} -> ${nextVersion} (dry run)`);
  process.exit(0);
}

packageJson.version = nextVersion;

try {
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

  const syncResult = spawnSync(process.execPath, [syncVersionScriptPath], {
    cwd: projectRoot,
    stdio: "inherit",
  });

  if (syncResult.status !== 0) {
    throw new Error(`sync_version.mjs failed with exit code ${syncResult.status ?? "unknown"}`);
  }

  console.log(`[bump:patch] ${currentVersion} -> ${nextVersion}`);
} catch (error) {
  fs.writeFileSync(packageJsonPath, packageJsonRaw);
  throw error;
}
