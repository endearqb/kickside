# Kimi Desktop Shell Release Notes

Version: `v0.0.25`  
Release date: `2026-03-18`

## Highlights

This release introduces a major redesign of the Control Center into an editorial dashboard, adds multimodal support for Feishu (images/files), and features a robust refactor of the IM Bridge core for improved reliability and persistence.

## Main Changes

1. **Control Center Editorial Redesign**
- The Control Center has been restructured into an **Editorial Dashboard** that provides a health summary, priority tasks, and quick actions at a glance.
- Onboarding has been reworked into a progress-driven layout with a visible step rail and focused detail panels.
- Runtime and diagnostics views now follow a summary-first flow with expandable deep-dive panels.
- Introduced dedicated design tokens, typography, and motion effects to create a more premium visual experience.

2. **Feishu Multimodal & Interactive Integration**
- **Inbound Multimodal**: The bridge now supports receiving images and files from Feishu. Attachments are staged locally and consumed as part of the next eligible text prompt to Kimi.
- **Outbound Multimodal**: Extended the Feishu gateway to support sending images, files, and interactive message cards.
- **Reply Renderer Selector**: Users can now explicitly choose between "Post" and "Interactive" rendering for Feishu replies in the Bridge Runtime settings, replacing the legacy toggle.

3. **IM Bridge Core Refactor**
- Introduced a new `bridgecore` orchestration layer to decouple provider logic from platform adapters.
- Added robust persistence for turns, events, and delivery metadata using SQLite migrations (up to schema version 8).
- Improved reliability with automatic session lease management and better checkpoint tracking for Telegram and Feishu.

4. **Visual & UX Refinements**
- Unified modal sizing and corner-radius hierarchy across all Control Center surfaces.
- Improved responsive behavior for narrow windows, ensuring full readability on small screens.
- Smoother transitions and better state mapping for success, warning, and error states.

## Installers

- NSIS: `Kimi Desktop Shell_0.0.25_x64-setup.exe`
- MSI: `Kimi Desktop Shell_0.0.25_x64_en-US.msi`

## Verification

- `pnpm -C apps/kimi-shell build`
- `go test ./apps/kimi-im-bridge/...`