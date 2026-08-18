---
name: release-kickside
description: Prepare, publish, mirror, and verify a KickSide desktop release across GitHub and Gitee. Use when bumping a KickSide version, updating release notes and documentation, pushing main and an annotated tag, running the signed Tauri release workflow, mirroring canonical artifacts to Gitee, recovering from Gitee API upload timeouts, or auditing a completed dual-source release.
---

# Release KickSide

Release KickSide with GitHub as the only build authority and Gitee as a byte-identical mainland mirror. Treat each phase as fail-closed: never expose an incomplete Gitee release or claim a validation level that was not demonstrated.

## 1. Establish the contract

Work from the KickSide repository root. Before editing, read `AGENTS.md`, `.ai/CONSTITUTION.md`, `README_First.md`, the root `README.md`, `.ai/architecture/README.md`, `current-state.md`, `verification-gates.md`, relevant accepted release ADRs, and every README governing touched paths.

Record the exact target version, intended features, non-goals, signing state, affected files, acceptance criteria, documentation triggers, and validation gates in `tasks/todo.md`. Check the worktree and both remotes. Preserve unrelated user changes.

## 2. Preflight irreversible conditions

- Confirm the target tag is absent from both remotes and all version declarations agree.
- Inspect GitHub Actions secret *names*, never secret values. Require the Tauri updater key/password and `GITEE_RELEASE_TOKEN`.
- Determine macOS Developer ID, notarization, stapling, and Gatekeeper status from evidence. Never extend an unsigned-release exception to a new tag without explicit owner authorization and an exact-tag accepted ADR.
- Confirm the Gitee repository is public, its target commit/tag can be synchronized, and release storage remains within platform limits.
- Keep access tokens out of command arguments, logs, documentation, commits, and updater manifests.

Stop before tagging if any release condition is ambiguous or unsupported.

## 3. Prepare the release commit

Synchronize the version in `apps/kimi-shell/package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`. Update the exact-tag release workflow guard, manual mirror default, release notes, README content, architecture facts, ADRs, and `.ai/changes/YYYY-MM-DD.md` when triggered by project governance.

Release notes for an unsigned macOS build must begin with the exact warning required by the accepted ADR and describe first-launch limitations plainly. Do not present the updater signature as Apple code signing.

Use repository-owned release scripts and workflows; do not duplicate their logic in the skill.

## 4. Validate before publishing

Run the gates listed in `.ai/architecture/verification-gates.md`, including, as applicable:

- TypeScript typecheck, Vitest, security/registry checks, and production frontend build.
- Sidecar build; Rust format, locked check, strict clippy, and locked tests.
- Go vet, tests, and race tests.
- Updater-manifest and Gitee-publisher Node tests; workflow YAML parsing and diff checks.

Resolve failures before continuing. Record commands and outcomes rather than summarizing them as “tests passed.”

## 5. Publish main and tag

Commit the reviewed release scope intentionally. Push the release commit to GitHub `main`, then synchronize Gitee `main`. If local Gitee Git credentials are unavailable, use the already authenticated Gitee repository mirror UI only with explicit release authorization; keep remote-branch/tag deletion and wiki-sync options off.

Verify both remote `main` refs equal the release commit. Wait for the GitHub main CI run and require every expected job to succeed.

Create an annotated `vX.Y.Z` tag at that commit, push it to GitHub, synchronize it to Gitee, and verify both the tag object and dereferenced commit match. Never move a published tag.

## 6. Verify GitHub canonical release

Monitor the tag-triggered release workflow. Require the GitHub release to be public, non-draft, non-prerelease, and attached to the exact tag. For the current desktop matrix, require exactly these eight assets:

- Windows NSIS installer and `.sig`.
- Windows MSI installer and `.sig`.
- macOS Apple Silicon `.app.tar.gz` and `.sig`.
- macOS Apple Silicon `.dmg`.
- `latest.json`.

Require every asset to be uploaded, non-empty, and to have a GitHub API SHA-256 digest. Download each canonical asset and compare its local size and SHA-256 with the API metadata. Validate manifest version, tag-specific HTTPS URLs, platform keys, and signatures.

## 7. Mirror to Gitee safely

Prefer the repository's automated Gitee mirror. GitHub artifacts remain canonical; never rebuild on Gitee.

The Gitee release must remain prerelease while staging. Upload the seven installers/signatures first. Publicly re-download every item from its fixed-tag Gitee URL and compare size and SHA-256 with the GitHub canonical copy. Generate a separate Gitee `latest.json` using the repository generator, preserving version, notes, publication date, and signatures while changing only release URLs to the fixed Gitee tag.

Upload `latest.json` last, publicly download it, and verify exact bytes and JSON semantics. Require exactly eight Gitee attachments before promoting the release to stable. Finally verify both the tag release and Gitee `/releases/latest` report the exact tag with `prerelease=false`.

If the automated API upload times out, keep the prerelease staged and use the signed-in Gitee browser only after explicit release authorization. Upload canonical files through the release editor, reconcile attachment names after each submission, and follow the same public download/hash, manifest-last, and stable-promotion gates. Never overwrite a divergent stable release.

## 8. Close out

Verify GitHub and Gitee `main`, annotated tag targets, public release state, attachment matrices, updater manifests, and fixed/latest endpoints one final time. Record actual commit IDs, Actions run URLs, fallback behavior, validation evidence, and known limitations in `tasks/todo.md` and `.ai/changes/YYYY-MM-DD.md`; commit and push that closeout record to both `main` branches without moving the release tag.

Move temporary release downloads to Trash after verification. Report the GitHub release, Gitee release, CI run, commit, and any explicit signing caveat. A failed automated mirror that was safely recovered is still a workflow defect worth recording; do not describe the failed job itself as successful.
