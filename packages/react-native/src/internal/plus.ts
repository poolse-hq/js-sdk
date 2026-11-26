// Pure helpers for MessagingPlus.tsx (no React Native imports, so vitest runs them under node).

// One formatBytes for every component, web and React Native.
export { formatBytes } from '@poolse/react';

/** Block and summary text without Markdown markers (RN renders it as plain text). */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(\*\*|__|~~|`)(.+?)\1/g, '$2')
    .replace(/(^|\s)[*_](\S[^*_]*?)[*_](?=\s|$)/g, '$1$2')
    .replace(/^#{1,6}\s+/gm, '');
}

/** The note id in a Workspace note link, or `null`. */
export function noteIdFromLink(url: string): string | null {
  const m = /\/workspace\/l\/note\/([A-Za-z0-9-]{8,64})(?:[/?#]|$)/.exec(url);
  return m ? m[1]! : null;
}
