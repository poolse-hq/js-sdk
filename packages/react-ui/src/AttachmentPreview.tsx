// AttachmentPreview — render an attachment by id (or by full row).
// Image attachments show inline; everything else renders as a file
// card with download link. Uses `useAttachmentUrl` internally so a
// presigned GET URL is fetched on demand.

import type { Attachment, Uuid } from '@poolse/sdk';
import { useAttachmentUrl } from '@poolse/react';
import { useEffect, useState } from 'react';
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
  // The URL is re-signed before it expires (an open chat outlives it),
  // and again when the image fails to load.
  const { url, loading, refresh } = useAttachmentUrl(attachment.id);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  if (loading) {
    return (
      <div className="poolse-attachment poolse-list--placeholder" aria-busy="true">
        Loading attachment…
      </div>
    );
  }

  if (!url) {
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
        <button
          type="button"
          className="poolse-attachment__image-button"
          aria-label={filename ? `Open ${filename}` : 'Open image'}
          onClick={() => {
            if (onClick) {
              onClick({ id: attachment.id });
              return;
            }
            setLightboxOpen(true);
          }}
        >
          <img
            className="poolse-attachment__image"
            src={url}
            alt={filename ?? 'attachment'}
            loading="lazy"
            onError={refresh}
          />
        </button>
        {lightboxOpen && (
          <Lightbox
            url={url}
            filename={filename}
            onClose={() => setLightboxOpen(false)}
            onError={refresh}
          />
        )}
      </div>
    );
  }

  // File card mode.
  const filename = isFullRow ? (attachment.original_filename ?? 'file') : 'file';
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
        <PoolseIcon
          name="attachment"
          size={20}
          className="poolse-attachment__file-icon"
          label={null}
        />
        <div className="poolse-attachment__file-body">
          <div className="poolse-attachment__file-name">{filename}</div>
          {byteSize !== null && (
            <div className="poolse-attachment__file-meta">{formatBytes(byteSize)}</div>
          )}
        </div>
        <PoolseIcon
          name="download"
          size={16}
          className="poolse-attachment__file-icon"
          label="Download"
        />
      </a>
    </div>
  );
}

/**
 * The full-screen viewer for the images of one message, opened at
 * `index`; ← / → (and the buttons) step through all of them, including
 * those the bubble's mosaic has no tile for.
 */
export function ImageGallery({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: Array<Attachment | { id: Uuid }>;
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const att = images[index];
  const { url, refresh } = useAttachmentUrl(att?.id ?? null);
  if (!att || !url) return null;
  const filename = 'original_filename' in att ? (att.original_filename ?? null) : null;
  const n = images.length;
  return (
    <Lightbox
      url={url}
      filename={filename}
      onClose={onClose}
      onError={refresh}
      {...(n > 1
        ? {
            position: `${index + 1} of ${n}`,
            ...(index > 0 ? { onPrev: () => onIndex(index - 1) } : {}),
            ...(index < n - 1 ? { onNext: () => onIndex(index + 1) } : {}),
          }
        : {})}
    />
  );
}

function Lightbox({
  url,
  filename,
  onClose,
  onPrev,
  onNext,
  position,
  onError,
}: {
  url: string;
  filename: string | null;
  onClose: () => void;
  /** The image failed to load (an expired URL): fetch a fresh one. */
  onError?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  /** "2 of 6", when it's one of several. */
  position?: string;
}) {
  // ESC closes, arrows step; lock background scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && onPrev) onPrev();
      else if (e.key === 'ArrowRight' && onNext) onNext();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, onPrev, onNext]);

  // `position: fixed` escapes the scrollable messages container
  // because nothing in that ancestor chain creates a new containing
  // block (no transform / filter / perspective). If a host app wraps
  // ConversationView in a `transform: ...` ancestor, this fixed
  // overlay would scope to that — at which point a `createPortal`
  // path is what they want (out of scope for the default surface).
  return (
    <div
      className="poolse-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={filename ?? 'Image preview'}
      onClick={onClose}
    >
      <button
        type="button"
        className="poolse-lightbox__close"
        aria-label="Close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        ×
      </button>
      {/* Clicking the image itself shouldn't close the lightbox — only
          the backdrop. */}
      <img
        className="poolse-lightbox__image"
        src={url}
        alt={filename ?? 'attachment'}
        onClick={(e) => e.stopPropagation()}
        {...(onError ? { onError } : {})}
      />
      {onPrev && (
        <button
          type="button"
          className="poolse-lightbox__step poolse-lightbox__step--prev"
          aria-label="Previous image"
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
        >
          ‹
        </button>
      )}
      {onNext && (
        <button
          type="button"
          className="poolse-lightbox__step poolse-lightbox__step--next"
          aria-label="Next image"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
        >
          ›
        </button>
      )}
      {position && <span className="poolse-lightbox__position">{position}</span>}
      <a
        className="poolse-lightbox__download"
        href={url}
        download={filename ?? undefined}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
      >
        Download
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
