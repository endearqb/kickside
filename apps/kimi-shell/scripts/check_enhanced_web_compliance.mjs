import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "docs/kimi-web-enhanced-plan.md",
  "docs/third-party-notices.md",
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
  readFileSync(resolve(root, "public/enhanced-kimi-web/manifest.json"), "utf8"),
);
const source = readFileSync(resolve(root, "third_party/kimi-cli-web/SOURCE.md"), "utf8");
const notices = readFileSync(resolve(root, "docs/third-party-notices.md"), "utf8");
const license = readFileSync(resolve(root, "third_party/kimi-cli-web/LICENSE"), "utf8");

const commit = manifest.upstreamCommit;
if (!commit || !source.includes(commit)) {
  console.error("Enhanced Web source commit is missing or not mirrored in SOURCE.md.");
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

console.log(`Enhanced Web compliance check passed (${commit}).`);
