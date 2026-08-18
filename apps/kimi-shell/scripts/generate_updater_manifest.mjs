import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const PLATFORM_KEYS = ["windows-x86_64", "darwin-aarch64"];
const RELEASE_HOSTS = new Set(["github.com", "gitee.com"]);

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`invalid argument near ${key ?? "<end>"}`);
    }
    values.set(key.slice(2), value);
  }
  return values;
}

function requireValue(values, key) {
  const value = values.get(key)?.trim();
  if (!value) {
    throw new Error(`--${key} is required`);
  }
  return value;
}

function assertSemver(version) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`invalid semantic version: ${version}`);
  }
}

function assertReleaseUrl(value, expectedTag) {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error(`release asset URL must use HTTPS: ${value}`);
  }
  if (!RELEASE_HOSTS.has(url.hostname)) {
    throw new Error(`release asset URL uses an unsupported host: ${value}`);
  }
  if (!url.pathname.includes(`/releases/download/${expectedTag}/`)) {
    throw new Error(`release asset URL does not target ${expectedTag}: ${value}`);
  }
  return url.toString();
}

async function readSignature(filePath) {
  const signature = (await readFile(filePath, "utf8")).trim();
  if (!signature || signature.includes("\n")) {
    throw new Error(`invalid updater signature file: ${filePath}`);
  }
  return signature;
}

export async function buildManifest(values) {
  const version = requireValue(values, "version");
  assertSemver(version);
  const tag = requireValue(values, "tag");
  if (tag !== `v${version}`) {
    throw new Error(`tag ${tag} does not match version ${version}`);
  }

  const platforms = {
    "windows-x86_64": {
      url: assertReleaseUrl(requireValue(values, "windows-url"), tag),
      signature: await readSignature(requireValue(values, "windows-signature-file")),
    },
    "darwin-aarch64": {
      url: assertReleaseUrl(requireValue(values, "macos-url"), tag),
      signature: await readSignature(requireValue(values, "macos-signature-file")),
    },
  };
  if (Object.keys(platforms).some((key) => !PLATFORM_KEYS.includes(key))) {
    throw new Error("updater manifest contains an unsupported platform key");
  }

  const publishedAt = values.get("pub-date")?.trim() || new Date().toISOString();
  if (Number.isNaN(Date.parse(publishedAt))) {
    throw new Error(`invalid --pub-date: ${publishedAt}`);
  }

  return {
    version,
    notes: values.get("notes")?.trim() || `KickSide ${version}`,
    pub_date: new Date(publishedAt).toISOString(),
    platforms,
  };
}

async function main() {
  const values = parseArgs(process.argv.slice(2));
  const outputPath = path.resolve(requireValue(values, "output"));
  const manifest = await buildManifest(values);
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`wrote updater manifest to ${outputPath}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
