# Kimi Desktop Shell Release Notes

Version: `v0.0.26`  
Release date: `2026-03-18`

## Highlights

This release streamlines the Control Center into a single full experience, keeps top-level tabs always visible, adds a one-click Bridge start entry in the status bar, and introduces a refreshable random Tips card in the Overview brief when no blockers are present.

## Main Changes

1. **Control Center Chrome Simplification**
- Unified Control Center chrome to a single `full` mode and removed the old `dashboard/full` split logic.
- `openControlCenter()` now opens the same tabbed overview experience in workspace modal mode by default.
- Existing deep links (`/control-center`, `/onboarding`, `/diagnostics`, `/logs_paths`) still work, but now land inside one consistent tab framework.

2. **Persistent Header Tabs (Modal + Fullscreen)**
- Control Center header now uses a single-row layout: title (left), tabs (center), close button (right).
- Top-level tabs are always visible across both fullscreen and modal surfaces, including the **IM Bridge** page.
- On narrow widths, tabs stay on one line and scroll horizontally instead of wrapping.

3. **Bridge Status Tag in Bottom Bar**
- Added an `IM Bridge` status tag button in `statusbar-left`.
- Unified status labels to short terms: `就绪 / 进行中 / 异常 / 待办`.
- Interaction behavior:
  - `stopped` / `crashed`: clickable, one-click start.
  - `running` / `starting` / `degraded` / `stopping`: display-only (non-clickable).
- Added dedicated mini-tag visual states and readable disabled styling.

4. **Overview Brief: Random Tips Card**
- In the Overview “简报” section:
  - If blockers exist, keep the current blocker list.
  - If no blockers exist, render a random Tips card.
- Tips reuse the same source used by startup/shutdown small windows.
- Added a compact refresh button in the top-right corner of the card to re-randomize **only** this brief card.

5. **Bridge Auto-Approve Wiring Hardening (Feishu)**
- Added and normalized `feishuAutoApprove` across Go bridge config, Rust settings store, and TS settings model.
- Preserved backward compatibility for legacy settings files by defaulting missing values safely.
- Clarified runtime prompting that changes require bridge restart to fully take effect.

## Installers

- NSIS: `Kimi Desktop Shell_0.0.26_x64-setup.exe`
- MSI: `Kimi Desktop Shell_0.0.26_x64_en-US.msi`

## Verification

- `pnpm -C apps/kimi-shell build`
- `go test ./internal/config ./internal/adapters/feishu ./internal/bridgecore ./internal/runtime` (workdir: `apps/kimi-im-bridge`)
