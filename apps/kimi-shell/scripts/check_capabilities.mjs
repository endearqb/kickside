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
const dangerousMainOnlyPermissions = new Set([
  "core:webview:allow-create-webview",
  "core:webview:allow-create-webview-window",
  "core:webview:allow-set-webview-focus",
  "core:webview:allow-set-webview-position",
  "core:webview:allow-set-webview-size",
  "core:webview:allow-webview-close",
]);

if (!capability) {
  errors.push("missing default capability");
} else {
  if (capability.local !== true) {
    errors.push("default capability must set local=true");
  }
  if (capability.remote != null) {
    errors.push("default capability must not allow remote URLs");
  }
  if (JSON.stringify(capability.windows ?? []) !== JSON.stringify(["main"])) {
    errors.push("default capability must only target the main window");
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

for (const item of capabilityList) {
  if (item?.local !== true) {
    errors.push(`capability ${item?.identifier ?? "<unknown>"} must set local=true`);
  }
  if (item?.remote != null) {
    errors.push(`capability ${item?.identifier ?? "<unknown>"} must not allow remote URLs`);
  }
  const permissions = item?.permissions ?? [];
  if (item?.identifier !== "default") {
    for (const permission of permissions) {
      if (dangerousMainOnlyPermissions.has(permission)) {
        errors.push(`${permission} must stay scoped to the main window capability`);
      }
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
