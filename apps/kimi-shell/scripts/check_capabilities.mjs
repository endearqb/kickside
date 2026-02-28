import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.cwd(), "src-tauri", "capabilities", "default.json");
const raw = JSON.parse(fs.readFileSync(root, "utf8"));

const capabilityList = Array.isArray(raw)
  ? raw
  : Array.isArray(raw.capabilities)
    ? raw.capabilities
    : [raw];

const capability = capabilityList.find((item) => item.identifier === "default");
const errors = [];

if (!capability) {
  errors.push("missing default capability");
} else {
  if (capability.local !== true) {
    errors.push("default capability must set local=true");
  }
  if (capability.remote != null) {
    errors.push("default capability must not allow remote URLs");
  }

  const permissions = capability.permissions ?? [];
  if (permissions.includes("dialog:default")) {
    errors.push("dialog:default is too broad, use dialog:allow-open");
  }
  if (!permissions.includes("dialog:allow-open")) {
    errors.push("dialog:allow-open must be present");
  }

  const forbiddenPrefixes = ["shell:", "fs:", "http:", "process:"];
  for (const permission of permissions) {
    if (typeof permission !== "string") continue;
    if (forbiddenPrefixes.some((prefix) => permission.startsWith(prefix))) {
      errors.push(`forbidden permission found: ${permission}`);
    }
  }
}

if (errors.length > 0) {
  console.error("Capability check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Capability check passed.");
