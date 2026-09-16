/**
 * safeExternalUrl - allow only http/https web URLs for external links.
 *
 * Scraped job URLs are untrusted input. Before anything renders them as
 * clickable navigation they must be validated: a `javascript:`, `data:`, or
 * other executable scheme would otherwise run in the user's browsing context.
 * Anything without a web scheme (http/https) is rejected, so the caller can
 * refuse to render a link at all rather than emit a clickable `href`.
 */
export function safeExternalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
    return null;
  } catch {
    // Malformed or relative (scheme-less) input — not a safe web URL.
    return null;
  }
}