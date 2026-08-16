# Kimi Web Style Mapping (Shell)

## Purpose

This document tracks the boundary between the shell design system and the embedded Kimi Web rendering surface. `DESIGN.md` remains authoritative for shell-owned UI.

## Mapping

- Surface system: neutral grayscale surfaces with subtle layered borders.
- Accent system: shell-owned UI uses the `DESIGN.md` green only for enabled/healthy state; embedded Kimi Web retains its own blue brand semantics.
- Density: compact controls (`30px` button/input height) with low-noise spacing.
- Layout: app-level titlebar + full-height content region without outer card radius.
- Control Center IA: left navigation + right content cards (overview/onboarding/diagnostics/logs).

## Token decisions used in shell

- Light shell background: `#f5f6f8`
- Light primary surface: `#ffffff`
- Light border: `#e6e8ec`
- Dark shell background: `#0f1115`
- Dark primary surface: `#171a21`
- Dark border: `#262b35`
- Shell enabled/healthy accent: `#34c284`
- Embedded Kimi fallback blue: `#1783ff`

## Notes

- The shell keeps its own frameless desktop titlebar, so it does not copy Kimi Web's browser header.
- Theme remains `light/dark` only and is synchronized with embedded Kimi Web through the exact-origin `kimi-shell-theme-sync` bridge.
- Kimi layout enhancement resolves `--logo` / `--blue` before other Kimi variables and only then uses the host accent as a fallback. Kimi blue never redefines shell tokens, and shell green is not forced over a valid Kimi brand color.
