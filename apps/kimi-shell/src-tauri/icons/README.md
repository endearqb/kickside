# Icon Regeneration

Use `moonki.png` as the editable source logo and regenerate all app icons in two steps.

## 1. Generate the rounded master PNG

```powershell
powershell -ExecutionPolicy Bypass -File apps\kimi-shell\scripts\generate_rounded_icon.ps1
```

This writes `moonki-rounded-master.png` in the same folder as the reusable 1024x1024 source for bundling.

## 2. Regenerate the Tauri icon set

```powershell
pnpm --dir apps/kimi-shell tauri icon src-tauri/icons/moonki-rounded-master.png
```

This refreshes `icon.ico`, `icon.icns`, `32x32.png`, `128x128.png`, `128x128@2x.png`, the Windows `Square*Logo.png` assets, and the mobile icon outputs under this directory.
