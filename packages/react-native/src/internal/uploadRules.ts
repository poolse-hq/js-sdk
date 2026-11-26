// Upload size / type checks for <AttachmentPicker> — pure, so vitest
// can run it under node.

import { formatBytes } from '@poolse/react';

export { formatBytes };

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

/**
 * A picked file, which may have been converted before upload (photos
 * become WebP): the type is accepted when either the original or the
 * converted file matches, and the size is the uploaded one's.
 */
export function pickedFileRejection(
  file: {
    contentType: string;
    byteSize: number;
    filename?: string | null;
    /** What was picked, before conversion. */
    source?: { contentType: string; filename?: string | null } | null;
  },
  rules: UploadRules,
): string | null {
  const why = uploadRejection(file, rules);
  if (!why || !file.source) return why;
  // The converted file is refused: by size (the original can't help),
  // or by type, where the original's type may be the accepted one.
  const asPicked = uploadRejection(
    {
      contentType: file.source.contentType,
      byteSize: file.byteSize,
      filename: file.source.filename ?? null,
    },
    rules,
  );
  return asPicked === null ? null : why;
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
