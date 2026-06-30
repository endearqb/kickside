export function getKimiAssistantDisplayName(language = globalThis.navigator?.language ?? "zh-CN") {
  return language.toLowerCase().startsWith("zh") ? "kimi小助手" : "kimi sidekick";
}
