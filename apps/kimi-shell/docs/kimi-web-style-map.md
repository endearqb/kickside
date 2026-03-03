# Kimi Web Style Mapping (Shell)

## Purpose

This document tracks how the shell UI aligns with Kimi Web visual language while keeping the current React + CSS stack.

## Mapping

- Surface system: neutral grayscale surfaces with subtle layered borders.
- Accent system: single blue accent for selected state and action emphasis.
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
- Accent (light): `#2563eb`
- Accent (dark): `#6ea8fe`

## Notes

- The shell keeps its own frameless desktop titlebar, so it does not copy Kimi Web's browser header.
- Theme remains `light/dark` only and is synchronized with embedded Kimi Web via postMessage bridge.
