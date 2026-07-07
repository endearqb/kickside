export type UrlSafetyResult =
  | { ok: true; url: string }
  | {
      ok: false;
      reason: "empty" | "unsupported_protocol" | "invalid" | "origin_not_allowed";
    };

const DEFAULT_EXTERNAL_FRAME_ORIGINS = new Set([
  "https://kimi.com",
  "https://www.kimi.com",
]);

export function normalizeEmbeddableUrl(input: string): UrlSafetyResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty" };
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, reason: "unsupported_protocol" };
    }
    if (!isAllowedExternalFrameOrigin(url.origin)) {
      return { ok: false, reason: "origin_not_allowed" };
    }
    url.hash = "";
    return { ok: true, url: url.toString() };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

export function isAllowedExternalFrameOrigin(origin: string): boolean {
  if (DEFAULT_EXTERNAL_FRAME_ORIGINS.has(origin)) {
    return true;
  }

  const configuredOrigins = String(
    import.meta.env.VITE_KIMI_EXTERNAL_FRAME_ALLOWLIST ?? "",
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return configuredOrigins.includes(origin);
}
