# Kimi Desktop Shell Release Notes

Version: `v0.0.30`  
Release date: `2026-03-21`

## Highlights

This release focuses on everyday usability: a new Skill Center for installing and applying Kimi skills, a clearer IM Bridge control flow for ordinary users, and log timestamps that now match your local time zone.

## What's New

1. **New Skill Center**
- Added a built-in `Skill Center` for installing skills directly from Git.
- Skills are now installed into the app's private storage first, instead of being dropped directly into Kimi's discovery paths.
- Each skill can be applied in two explicit scopes:
  - `应用到用户全局`
  - `仅应用到当前 Session`
- Added a titlebar `Skill` button with a badge showing how many skills are currently applied to the active session.
- Added a full `Skill Center` page in Control Center for search, filtering, trust management, apply/remove actions, and recent skills for the current workspace.

2. **Clearer IM Bridge Behavior**
- Reworked the `IM Bridge` panel around a simpler primary flow for normal users.
- Reduced the confusion from having too many `启动 / 保存 / 重启` style actions visible at once.
- Added an explicit `重置到 IM 默认目录并新建会话` action.
- Changing the IM default directory no longer silently rewrites an existing binding when bridge restarts; returning to the default directory is now a deliberate action.

3. **Log Time Zone Consistency**
- Unified app logs, bridge logs, and UI time displays to use the local machine time zone.
- Log output now includes clear local-time formatting, making diagnostics easier to read directly from files and inside the app.

## Notes

- `应用到用户全局` now means the Kimi user-level global skills directory, not `IM 默认目录/.agents/skills`.
- `仅应用到当前 Session` writes to the current session work directory's `.agents/skills`, and the app will clean up its managed session skill projections when the session changes or is cleared.
