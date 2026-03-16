# Kimi IM Bridge Refactor Todo

## Hard Constraints

- [x] Keep CLI flags and admin API behavior stable.
- [x] Keep `go test ./...` green after each implementation phase.
- [x] Use additive SQLite migrations only; no destructive schema rewrites.

## Implementation

- [x] Add `internal/bridgecore` types, interfaces, and orchestrator.
- [x] Add `internal/providers/kimi` and move provider/session orchestration there.
- [x] Add `internal/adapterkit` shared inbound/checkpoint/approval contracts.
- [x] Add `internal/platforms/{telegram,feishu}` and switch app wiring to them.
- [x] Expand store/domain for turns, events, checkpoints, leases, and delivery metadata.
- [x] Split `internal/app` into wiring and lifecycle responsibilities.
- [x] Keep `internal/runtime` as an admin/debug compatibility facade.
- [x] Add or update tests for bridgecore, provider, migrations, and app wiring.
- [x] Run full package tests and verify migration coverage.

## Review

- [x] Confirm app startup still initializes channels and reconciles pending approvals.
- [x] Confirm Telegram and Feishu adapters only advance checkpoints after successful handling.
- [x] Confirm turn/approval persistence keeps `turn_id` and `step_id`.

## Retrospective

- Introduced `bridgecore` as the orchestration seam without breaking legacy adapter tests by making adapters accept either the old runtime path or the new orchestrator path.
- Added additive migrations through schema version 7 so old databases can move forward without rebuilds.
- Kept admin/debug behavior stable by leaving `internal/runtime` in place while production adapter wiring now flows through provider + bridgecore.

---

# Kimi Shell Control Center UI Todo

## Hard Constraints

- [x] Keep backend commands, bridge/admin APIs, and Tauri window topology unchanged.
- [x] Keep lightweight interactions inline in cards; heavy Bridge/API config must use dedicated modals.
- [x] Keep modal structure consistent: fixed header + fixed footer + scrollable body only.

## Implementation

- [x] Flatten onboarding/settings cards so core fields are visible without accordion expansion.
- [x] Remove the work-dir detail modal and keep work-dir editing directly in the card.
- [x] Convert Bridge onboarding/detail flow into a dedicated Bridge config modal for config + secrets only.
- [x] Add shared control-center modal shell and shared card header / status badge patterns.
- [x] Update runtime Bridge panel to separate normal actions from danger actions and add clearer grouping labels.
- [x] Rework install flow modal so only the body scrolls while header/footer remain fixed.
- [x] Update responsive styles so fullscreen and workspace modal surfaces share one layout language.

## Validation

- [ ] Verify control center works in fullscreen and workspace modal surfaces.
- [ ] Verify work-dir can be edited and saved inline without opening a modal.
- [ ] Verify API config and Bridge config only edit sensitive settings through dedicated modals.
- [ ] Verify modal `Escape` and overlay-close behavior still work with fixed header/footer shells.
- [x] Run a frontend build and confirm no layout regressions in the touched control-center flows.

## Retrospective

- Shared `ControlCenterModalShell` now enforces one modal rule across config, install, and Bridge setup: fixed header, fixed footer, and body-only vertical scrolling.
- Onboarding cards no longer mix accordion expansion with detail dialogs; lightweight actions stay inline, while API and Bridge heavy config are isolated in dedicated modals.
- Bridge runtime actions are easier to parse after splitting normal operations from danger groups, which also keeps destructive actions away from the primary flow.
- `pnpm build` 已通过；真实窗口的 fullscreen/workspace 双形态和手动交互 smoke 仍需在桌面端实际点检一次。
