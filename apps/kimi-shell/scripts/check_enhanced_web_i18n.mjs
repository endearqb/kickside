import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const i18nDir = resolve(root, "public", "enhanced-kimi-web", "i18n");
const defaultMessages = JSON.parse(
  readFileSync(resolve(i18nDir, "default.json"), "utf8"),
);
const zhMessages = JSON.parse(readFileSync(resolve(i18nDir, "zh-CN.json"), "utf8"));

const defaultKeys = Object.keys(defaultMessages).sort();
const zhKeys = Object.keys(zhMessages).sort();
const missingInZh = defaultKeys.filter((key) => !zhKeys.includes(key));
const extraInZh = zhKeys.filter((key) => !defaultKeys.includes(key));

if (missingInZh.length > 0 || extraInZh.length > 0) {
  console.error("Enhanced Web i18n keys are inconsistent.");
  if (missingInZh.length > 0) {
    console.error(`Missing in zh-CN: ${missingInZh.join(", ")}`);
  }
  if (extraInZh.length > 0) {
    console.error(`Extra in zh-CN: ${extraInZh.join(", ")}`);
  }
  process.exit(1);
}

console.log(`Enhanced Web i18n check passed (${defaultKeys.length} keys).`);
