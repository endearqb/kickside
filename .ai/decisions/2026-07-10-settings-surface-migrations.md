# Settings Surface Migrations

## Status

Accepted

## Decision

- Bump `AppSettings` schema to 9 and replace only known historical Explorer context-menu defaults with the new Chinese “Kimi 小助手” labels. Preserve every user-customized label.
- Stop creating Telegram connectors in Shell defaults. During Shell initialization, remove persisted Telegram connectors, legacy Telegram secrets, and connector-scoped Telegram secrets while preserving Feishu and Weixin data.
- Keep Tauri command shapes and the Go Bridge Telegram adapter unchanged.

## Rationale

- The menu rename must reach existing default installations without overwriting deliberate customization.
- The product surface now supports only Weixin and Feishu, and the user explicitly chose removal rather than hidden retention for existing Telegram configuration.
- Reusing the existing settings and secrets stores avoids a second migration framework.

## Consequences

- Context-menu self-heal rewrites enabled registry entries after the schema migration changes their expected labels.
- Telegram cleanup is destructive and idempotent; removed tokens are not backed up or written to logs.
- A future return of Telegram to the Shell UI requires a new explicit product decision and fresh configuration.
