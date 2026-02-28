# Kimi Desktop Shell

Desktop shell for `kimi web` built with Tauri v2 + React.

## MVP Features

- Auto-detect `kimi` executable (PATH or configured path)
- Launch `kimi web --no-open --host 127.0.0.1 --port <random>`
- Probe `/healthz` across `<port>..+9` and navigate to active URL
- Loading / Missing Kimi / Error local pages
- Tray menu: toggle window, restart backend, diagnostics, open logs, quit this instance
- Global shortcut: `CmdOrCtrl+Shift+K`
- Reliable shutdown with process cleanup on quit
- Local JSON settings + backend log file
- Work directory selection + save + restart
- Diagnostics page (version, ports, launch info, log tail)
- Multi-instance app processes (each window has an isolated backend process)
- Global shortcut is owned by the first running instance
- Startup metrics for NFR (`shell->loading`, `backend ready`)
- CLI contract check for `kimi web --help` required flags
- Split logs (`app.log` + `backend.log`) with log rotation

## Commands

```bash
pnpm install
pnpm tauri dev
pnpm build
pnpm tauri build --debug
pnpm check:nfr:security
# Windows only:
pnpm check:nfr:port-conflict
pnpm check:nfr:reliability
```

## Output Artifacts (Windows debug)

- EXE: `src-tauri/target/debug/appskimi-shell.exe`
- MSI: `src-tauri/target/debug/bundle/msi/Kimi Desktop Shell_0.1.0_x64_en-US.msi`
- NSIS: `src-tauri/target/debug/bundle/nsis/Kimi Desktop Shell_0.1.0_x64-setup.exe`

## Runtime Files

- Settings: app config dir `settings.json`
- Logs: app log dir `app.log`, backend stdio `backend.log`
