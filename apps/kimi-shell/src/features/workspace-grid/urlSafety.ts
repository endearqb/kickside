export type UrlSafetyResult =
  | { ok: true; url: string }
  | { ok: false; reason: "empty" | "unsupported_protocol" | "invalid" };

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
    url.hash = "";
    return { ok: true, url: url.toString() };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
