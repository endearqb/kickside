import { existsSync, readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const upstreamWebRoot = resolve(root, "third_party", "kimi-cli-web", "upstream-web");
const readUtf8 = (path) => readFileSync(path, "utf8").replace(/^\uFEFF/, "");
const requiredFiles = [
  "docs/kimi-web-enhanced-plan.md",
  "docs/kimi-web-maintenance.md",
  "docs/third-party-notices.md",
  "patches/kimi-web/README.md",
  "public/enhanced-kimi-web/index.html",
  "public/enhanced-kimi-web/manifest.json",
  "third_party/kimi-cli-web/LICENSE",
  "third_party/kimi-cli-web/SOURCE.md",
  "third_party/kimi-cli-web/CHANGES.md",
];

const missing = requiredFiles.filter((path) => !existsSync(resolve(root, path)));
if (missing.length > 0) {
  console.error(`Enhanced Web compliance files missing: ${missing.join(", ")}`);
  process.exit(1);
}

const manifest = JSON.parse(
  readUtf8(resolve(root, "public/enhanced-kimi-web/manifest.json")),
);
const source = readUtf8(resolve(root, "third_party/kimi-cli-web/SOURCE.md"));
const notices = readUtf8(resolve(root, "docs/third-party-notices.md"));
const license = readUtf8(resolve(root, "third_party/kimi-cli-web/LICENSE"));
const maintenance = readUtf8(resolve(root, "docs/kimi-web-maintenance.md"));

const commit = manifest.upstreamCommit;
if (!commit || !source.includes(commit)) {
  console.error("Enhanced Web source commit is missing or not mirrored in SOURCE.md.");
  process.exit(1);
}

if (!existsSync(upstreamWebRoot)) {
  console.error("Enhanced Web upstream snapshot is missing.");
  process.exit(1);
}

const upstreamEntries = readdirSync(upstreamWebRoot);
if (upstreamEntries.length === 0 || !upstreamEntries.includes("src")) {
  console.error("Enhanced Web upstream snapshot is empty or incomplete.");
  process.exit(1);
}

if (!license.includes("Apache License") || !license.includes("Version 2.0")) {
  console.error("Enhanced Web LICENSE does not look like Apache-2.0.");
  process.exit(1);
}

if (!notices.includes("不代表 MoonshotAI 官方背书")) {
  console.error("Third-party notices must include the brand disclaimer.");
  process.exit(1);
}

if (!maintenance.includes("当前运行时仍使用 workspace proxy 同源注入")) {
  console.error("Maintenance guide must describe the current injection-based runtime boundary.");
  process.exit(1);
}

console.log(`Enhanced Web compliance check passed (${commit}).`);
