# Kimi Desktop Shell Release Notes

Version: `v0.0.24`  
Release date: `2026-03-18`

## Highlights

This release focuses on Control Center visual consistency and Windows 11-style modal ergonomics. The main Control Center modal and task-level modals now follow a unified size system, overlay breathing space, and corner-radius hierarchy, with responsive behavior tuned for narrow windows and small screens.

## Main Changes

1. Unified modal sizing for Control Center surfaces
- Main Control Center modal (`.cc-shell-modal`) now uses a workstation-oriented size profile:
  - `width: clamp(960px, 86vw, 1280px)`
  - `height: min(88dvh, 940px)`
- Task-level modal shell (`.cc-modal-shell`) now uses a focused task profile:
  - `width: clamp(640px, 72vw, 1024px)`
  - `max-height: min(84dvh, 860px)`
- Applied the same sizing baseline across secondary modal variants used by config/install/bridge/onboarding-detail flows.

2. Overlay spacing and viewport stability improvements
- Unified modal overlay padding to:
  - `padding: clamp(8px, 2vw, 24px)`
- Replaced remaining modal height constraints tied to `vh` with `dvh` where applicable to reduce viewport jump and mobile address-bar jitter.

3. Consistent corner-radius hierarchy
- Main modal and task modal shells now align to `8px` corner radius.
- Content containers and primary cards in Control Center now align to `8px`:
  - `.control-center-shell .cc-sidebar`
  - `.control-center-shell .cc-card`
  - `.control-center-shell .block`
- Secondary child cards now align to `6px`:
  - `.cc-sidebar-editorial-stat`
  - `.cc-config-card`
  - `.cc-env-item`
  - `.cc-inline-summary-card`

4. Responsive behavior for narrow windows (`<= 640px`)
- Main and task-level modal surfaces now expand to full width in narrow layouts:
  - `width: 100%`
- Main modal height and task modal max-height now align to full viewport height:
  - `height: 100dvh`
  - `max-height: 100dvh`
- Narrow-screen modal corners are reduced to a compact `6px` to preserve edge readability while staying visually coherent.

5. Editorial redesign override alignment
- Updated the later Control Center redesign override block in `App.css` so final computed values remain consistent with the new modal size/radius standards.
- Scope is limited to size/radius and responsive visual behavior only; no interaction or business logic changes were introduced.

## Installers

- NSIS: `Kimi Desktop Shell_0.0.24_x64-setup.exe`
- MSI: `Kimi Desktop Shell_0.0.24_x64_en-US.msi`

## Verification

- `pnpm -C apps/kimi-shell build`
