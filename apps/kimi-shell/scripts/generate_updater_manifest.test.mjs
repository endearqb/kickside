import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildManifest } from "./generate_updater_manifest.mjs";

test("builds one deterministic manifest for Windows and Apple Silicon macOS", async () => {
  const directory = await import("node:fs/promises").then(({ mkdtemp }) =>
    mkdtemp(path.join(os.tmpdir(), "kimi-updater-manifest-")),
  );
  const windowsSignature = path.join(directory, "windows.sig");
  const macosSignature = path.join(directory, "macos.sig");
  await writeFile(windowsSignature, "windows-signature\n", "utf8");
  await writeFile(macosSignature, "macos-signature\n", "utf8");

  const manifest = await buildManifest(new Map([
    ["version", "0.2.0-beta.1"],
    ["tag", "v0.2.0-beta.1"],
    ["pub-date", "2026-08-10T00:00:00Z"],
    ["notes", "macOS beta"],
    ["windows-url", "https://github.com/endearqb/kickside/releases/download/v0.2.0-beta.1/KickSide.exe"],
    ["windows-signature-file", windowsSignature],
    ["macos-url", "https://github.com/endearqb/kickside/releases/download/v0.2.0-beta.1/KickSide.app.tar.gz"],
    ["macos-signature-file", macosSignature],
  ]));

  assert.equal(manifest.version, "0.2.0-beta.1");
  assert.deepEqual(Object.keys(manifest.platforms), ["windows-x86_64", "darwin-aarch64"]);
  assert.equal(manifest.platforms["darwin-aarch64"].signature, "macos-signature");
});

test("rejects a tag that does not match the version", async () => {
  await assert.rejects(
    () => buildManifest(new Map([["version", "0.2.0"], ["tag", "v0.2.1"]])),
    /does not match/,
  );
});
