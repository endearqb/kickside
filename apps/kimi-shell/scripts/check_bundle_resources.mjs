import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const configPath = path.resolve(process.cwd(), "src-tauri", "tauri.conf.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
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

if (errors.length > 0) {
  console.error("Bundle resource check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Bundle resource check passed.");
