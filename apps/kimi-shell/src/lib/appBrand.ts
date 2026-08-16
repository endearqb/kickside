export const APP_BRAND_EN = "KickSide";
export const APP_BRAND_ZH = "KickSide 启伴";

export function getKimiAssistantDisplayName(language = globalThis.navigator?.language ?? "zh-CN") {
  return language.toLowerCase().startsWith("zh") ? APP_BRAND_ZH : APP_BRAND_EN;
}
