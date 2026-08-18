import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const API_ROOT = "https://gitee.com/api/v5";

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`invalid argument near ${key ?? "<end>"}`);
    const name = key.slice(2);
    values.set(name, name === "asset" ? [...(values.get(name) ?? []), value] : value);
  }
  return values;
}

function required(values, key) {
  const value = values.get(key);
  if (typeof value !== "string" || !value.trim()) throw new Error(`--${key} is required`);
  return value.trim();
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function apiRequest(token, pathname, options = {}) {
  const response = await fetch(`${API_ROOT}${pathname}`, {
    ...options,
    headers: { Accept: "application/json", Authorization: `Bearer ${token}`, ...options.headers },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Gitee API ${options.method ?? "GET"} ${pathname} returned HTTP ${response.status}`);
  if (response.status === 204) return null;
  return response.json();
}

async function getReleaseByTag(token, owner, repo, tag) {
  const release = await apiRequest(token, `/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`);
  return release?.id ? release : null;
}

async function waitForTag(token, owner, repo, tag) {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      const tags = await apiRequest(token, `/repos/${owner}/${repo}/tags?per_page=100&page=1`);
      if (Array.isArray(tags) && tags.some((candidate) => candidate?.name === tag)) return;
    } catch (error) {
      if (attempt === 12) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`Gitee tag ${tag} did not become visible`);
}

async function downloadVerified(url, expectedBytes, label) {
  for (let attempt = 1; attempt <= 13; attempt += 1) {
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
    if (response.ok) {
      const actual = Buffer.from(await response.arrayBuffer());
      if (actual.length === expectedBytes.length && sha256(actual) === sha256(expectedBytes)) return;
      throw new Error(`public Gitee download checksum mismatch for ${label}`);
    }
    if (attempt === 13 || ![404, 429, 500, 502, 503, 504].includes(response.status)) {
      throw new Error(`public Gitee download failed for ${label}: HTTP ${response.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

async function createRelease(token, owner, repo, { tag, name, body, target }) {
  const payload = {
    tag_name: tag,
    name,
    body,
    target_commitish: target,
    prerelease: true,
  };
  return apiRequest(token, `/repos/${owner}/${repo}/releases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function updateRelease(token, owner, repo, release, { tag, name, body, prerelease }) {
  const payload = {
    tag_name: tag,
    name,
    body,
    prerelease,
  };
  return apiRequest(token, `/repos/${owner}/${repo}/releases/${release.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function listAttachments(token, owner, repo, releaseId) {
  return apiRequest(token, `/repos/${owner}/${repo}/releases/${releaseId}/attach_files`);
}

async function deleteAttachment(token, owner, repo, releaseId, attachmentId) {
  await apiRequest(token, `/repos/${owner}/${repo}/releases/${releaseId}/attach_files/${attachmentId}`, { method: "DELETE" });
}

async function uploadAttachment(token, owner, repo, releaseId, filename, bytes) {
  const form = new FormData();
  form.append("file", new Blob([bytes]), filename);
  return apiRequest(token, `/repos/${owner}/${repo}/releases/${releaseId}/attach_files`, {
    method: "POST",
    body: form,
  });
}

export async function publishGiteeRelease(values, token = process.env.GITEE_RELEASE_TOKEN) {
  if (!token) throw new Error("GITEE_RELEASE_TOKEN is not configured");
  const owner = required(values, "owner");
  const repo = required(values, "repo");
  const tag = required(values, "tag");
  const name = required(values, "name");
  const target = required(values, "target");
  const body = await readFile(required(values, "body-file"), "utf8");
  const assetPaths = values.get("asset") ?? [];
  const manifestPath = required(values, "manifest");
  if (!Array.isArray(assetPaths) || assetPaths.length === 0) throw new Error("at least one --asset is required");

  const assets = await Promise.all(assetPaths.map(async (filePath) => ({
    name: path.basename(filePath),
    bytes: await readFile(filePath),
  })));
  const manifest = { name: "latest.json", bytes: await readFile(manifestPath) };
  const expected = [...assets, manifest];
  if (new Set(expected.map((asset) => asset.name)).size !== expected.length) throw new Error("duplicate release asset name");

  await waitForTag(token, owner, repo, tag);
  let release = await getReleaseByTag(token, owner, repo, tag);
  if (!release) release = await createRelease(token, owner, repo, { tag, name, body, target });
  let attachments = await listAttachments(token, owner, repo, release.id);

  if (!release.prerelease) {
    if (attachments.length !== expected.length) throw new Error(`stable Gitee release ${tag} has an unexpected asset count`);
    for (const asset of expected) {
      const matches = attachments.filter((item) => item.name === asset.name);
      if (matches.length !== 1) throw new Error(`stable Gitee release ${tag} is missing ${asset.name}`);
      await downloadVerified(matches[0].browser_download_url, asset.bytes, asset.name);
    }
    return release;
  }

  const expectedNames = new Set(expected.map((asset) => asset.name));
  for (const attachment of attachments) {
    if (expectedNames.has(attachment.name)) {
      await deleteAttachment(token, owner, repo, release.id, attachment.id);
    } else {
      throw new Error(`staging Gitee release contains unexpected asset ${attachment.name}`);
    }
  }

  for (const asset of assets) {
    const uploaded = await uploadAttachment(token, owner, repo, release.id, asset.name, asset.bytes);
    await downloadVerified(uploaded.browser_download_url, asset.bytes, asset.name);
  }
  const uploadedManifest = await uploadAttachment(token, owner, repo, release.id, manifest.name, manifest.bytes);
  await downloadVerified(uploadedManifest.browser_download_url, manifest.bytes, manifest.name);

  attachments = await listAttachments(token, owner, repo, release.id);
  if (attachments.length !== expected.length) throw new Error("Gitee staging release asset matrix is incomplete");
  release = await updateRelease(token, owner, repo, release, { tag, name, body, prerelease: false });
  if (release.prerelease) throw new Error("Gitee release promotion did not produce a stable release");
  return release;
}

async function main() {
  const values = parseArgs(process.argv.slice(2));
  const release = await publishGiteeRelease(values);
  process.stdout.write(`published Gitee release ${release.tag_name ?? required(values, "tag")}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
