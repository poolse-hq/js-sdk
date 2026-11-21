// Upload size / type checks for <AttachmentPicker> — pure, so vitest
// can run it under node.

export interface UploadRules {
  /** Largest file accepted, in bytes. */
  maxFileSize?: number;
  /**
   * Accepted types: MIME types (`'application/pdf'`), wildcards
   * (`'image/*'`) or extensions (`'.pdf'`). Omitted: anything.
   */
  acceptedTypes?: readonly string[];
}

/** Why a file can't be attached, as a sentence to show; null when it can. */
export function uploadRejection(
  file: { contentType: string; byteSize: number; filename?: string | null },
  rules: UploadRules,
): string | null {
  const name = file.filename || 'This file';
  const { maxFileSize, acceptedTypes } = rules;
  if (acceptedTypes && acceptedTypes.length > 0 && !typeAccepted(file, acceptedTypes)) {
    return `${name} can't be attached: that file type isn't allowed.`;
  }
  if (typeof maxFileSize === 'number' && maxFileSize > 0 && file.byteSize > maxFileSize) {
    return `${name} is too large (${formatBytes(file.byteSize)}; the limit is ${formatBytes(maxFileSize)}).`;
  }
  return null;
}

function typeAccepted(
  file: { contentType: string; filename?: string | null },
  accepted: readonly string[],
): boolean {
  const type = (file.contentType || '').toLowerCase();
  const filename = (file.filename || '').toLowerCase();
  return accepted.some((raw) => {
    const rule = raw.trim().toLowerCase();
    if (!rule) return false;
    if (rule.startsWith('.')) return filename.endsWith(rule);
    if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}

/** "820 B", "1.4 MB", "12 MB". */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}
