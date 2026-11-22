// Pure helpers for MessagingPlus.tsx (no React Native imports, so vitest runs them under node).

/** Block and summary text without Markdown markers (RN renders it as plain text). */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(\*\*|__|~~|`)(.+?)\1/g, '$2')
    .replace(/(^|\s)[*_](\S[^*_]*?)[*_](?=\s|$)/g, '$1$2')
    .replace(/^#{1,6}\s+/gm, '');
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** The note id in a Workspace note link, or `null`. */
export function noteIdFromLink(url: string): string | null {
  const m = /\/workspace\/l\/note\/([A-Za-z0-9-]{8,64})(?:[/?#]|$)/.exec(url);
  return m ? m[1]! : null;
}
