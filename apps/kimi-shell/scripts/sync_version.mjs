import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const packageJsonPath = path.join(projectRoot, "package.json");
const cargoTomlPath = path.join(projectRoot, "src-tauri", "Cargo.toml");
const tauriConfPath = path.join(projectRoot, "src-tauri", "tauri.conf.json");

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const version = String(packageJson.version || "").trim();

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`Invalid package.json version: ${version}`);
}

const cargoTomlOriginal = fs.readFileSync(cargoTomlPath, "utf8");
const cargoLines = cargoTomlOriginal.split(/\r?\n/);
let inPackageSection = false;
let cargoUpdated = false;

for (let i = 0; i < cargoLines.length; i += 1) {
  const line = cargoLines[i];
  if (/^\s*\[package\]\s*$/.test(line)) {
    inPackageSection = true;
    continue;
  }
  if (inPackageSection && /^\s*\[.+\]\s*$/.test(line)) {
    inPackageSection = false;
  }
  if (inPackageSection && /^\s*version\s*=\s*".*"\s*$/.test(line)) {
    cargoLines[i] = `version = "${version}"`;
    cargoUpdated = true;
    break;
  }
}

if (!cargoUpdated) {
  throw new Error("Could not find [package].version in Cargo.toml");
}

const cargoTomlNext = cargoLines.join("\n");
if (cargoTomlNext !== cargoTomlOriginal) {
  fs.writeFileSync(cargoTomlPath, cargoTomlNext);
}

const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf8"));
tauriConf.version = version;
fs.writeFileSync(tauriConfPath, `${JSON.stringify(tauriConf, null, 2)}\n`);

console.log(
  `[sync:version] version=${version} -> Cargo.toml + tauri.conf.json synced from package.json`,
);
