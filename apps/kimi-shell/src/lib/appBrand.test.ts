import { describe, expect, it } from "vitest";
import { APP_BRAND_EN, APP_BRAND_ZH, getKimiAssistantDisplayName } from "./appBrand";

describe("app brand", () => {
  it("uses the bilingual brand in Chinese locales", () => {
    expect(getKimiAssistantDisplayName("zh-CN")).toBe(APP_BRAND_ZH);
    expect(getKimiAssistantDisplayName("zh-TW")).toBe("KickSide 启伴");
  });

  it("uses the canonical English brand in other locales", () => {
    expect(getKimiAssistantDisplayName("en-US")).toBe(APP_BRAND_EN);
    expect(getKimiAssistantDisplayName("ja-JP")).toBe("KickSide");
  });
});
