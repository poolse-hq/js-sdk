// AttachmentPreview — render an attachment by id (or by full row).
// Image attachments show inline; everything else renders as a file
// card with download link. Uses `useAttachmentUrl` internally so a
// presigned GET URL is fetched on demand.

import type { Attachment, Uuid } from '@poolse/sdk';
import { useAttachmentUrl } from '@poolse/react';
import { PoolseIcon } from './PoolseIcon.js';

export interface AttachmentPreviewProps {
  /**
   * The attachment to render. Pass either the full row (recommended
   * — saves a network round-trip; you usually have it from the
   * message payload) OR just the id. With just the id, the
   * file-vs-image discriminator falls back to the URL's content-type
   * detection from the file extension in `original_filename`.
   */
  attachment: Attachment | { id: Uuid };
  /** Optional click handler — defaults to "open in new tab" on file mode. */
  onClick?: (att: { id: Uuid }) => void;
}

export function AttachmentPreview({ attachment, onClick }: AttachmentPreviewProps) {
  const isFullRow = 'content_type' in attachment;
  const { url, loading, error } = useAttachmentUrl(attachment.id);

  if (loading) {
    return (
      <div className="poolse-attachment poolse-list--placeholder" aria-busy="true">
        Loading attachment…
      </div>
    );
  }

  if (error || !url) {
    return (
      <div className="poolse-attachment poolse-list--placeholder poolse-list--error">
        Failed to load attachment.
      </div>
    );
  }

  // Discriminate image vs file. Content-type from the row when we
  // have it; otherwise infer from the URL's extension as a fallback.
  const ct = isFullRow ? attachment.content_type : guessContentType(url);
  const isImage = ct.startsWith('image/');

  if (isImage) {
    const filename = isFullRow ? attachment.original_filename : null;
    return (
      <div className="poolse-attachment">
        {/* Clicking opens the image in a new tab — same as a download
            for raster formats. Customer can override via onClick. */}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            if (onClick) {
              e.preventDefault();
              onClick({ id: attachment.id });
            }
          }}
        >
          <img
            className="poolse-attachment__image"
            src={url}
            alt={filename ?? 'attachment'}
            loading="lazy"
          />
        </a>
      </div>
    );
  }

  // File card mode.
  const filename = isFullRow ? attachment.original_filename ?? 'file' : 'file';
  const byteSize = isFullRow ? attachment.byte_size : null;

  return (
    <div className="poolse-attachment">
      <a
        className="poolse-attachment__file"
        href={url}
        download={filename}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          if (onClick) {
            e.preventDefault();
            onClick({ id: attachment.id });
          }
        }}
      >
        <PoolseIcon name="attachment" size={20} className="poolse-attachment__file-icon" label={null} />
        <div className="poolse-attachment__file-body">
          <div className="poolse-attachment__file-name">{filename}</div>
          {byteSize !== null && (
            <div className="poolse-attachment__file-meta">{formatBytes(byteSize)}</div>
          )}
        </div>
        <PoolseIcon name="download" size={16} className="poolse-attachment__file-icon" label="Download" />
      </a>
    </div>
  );
}

function guessContentType(url: string): string {
  const m = url.match(/\.([a-z0-9]+)(?:\?|#|$)/i);
  if (!m) return 'application/octet-stream';
  const ext = m[1]!.toLowerCase();
  const imageExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg']);
  if (imageExts.has(ext)) return `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  return 'application/octet-stream';
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
