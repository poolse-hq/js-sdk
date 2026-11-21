// LinkPreviewCard — the card under a message for a link in its text:
// image, site name with favicon, title and description for a web page;
// the picture itself for a link straight to an image. The server
// fetches previews after the send, so they arrive a moment later as a
// `message:updated` — nothing is reserved for them until then.

import type { LinkPreview, Message } from '@poolse/sdk';
import { usePoolse } from '@poolse/react';
import { useState } from 'react';
import { PoolseIcon } from './PoolseIcon.js';

export interface LinkPreviewCardProps {
  preview: LinkPreview;
  /** Shows a × that calls this (the sender removing the preview). */
  onRemove?: () => void;
  className?: string;
}

export function LinkPreviewCard({ preview, onRemove, className }: LinkPreviewCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const [faviconFailed, setFaviconFailed] = useState(false);
  // Images aren't proxied: they load straight from the site. Only
  // http(s) targets are linked or loaded.
  if (!isWebUrl(preview.url)) return null;
  const image = preview.image_url && isWebUrl(preview.image_url) && !imageFailed;
  const host = hostOf(preview.url);

  const remove = onRemove ? (
    <button
      type="button"
      className="poolse-link-preview__remove"
      aria-label="Remove preview"
      title="Remove preview"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onRemove();
      }}
    >
      <PoolseIcon name="close" size={12} label={null} />
    </button>
  ) : null;

  if (preview.type === 'image') {
    const src = preview.image_url && isWebUrl(preview.image_url) ? preview.image_url : preview.url;
    if (imageFailed) return null;
    return (
      <div
        className={['poolse-link-preview', 'poolse-link-preview--image', className]
          .filter(Boolean)
          .join(' ')}
      >
        <a href={preview.url} target="_blank" rel="noopener noreferrer nofollow">
          <img
            className="poolse-link-preview__picture"
            src={src}
            alt={preview.title ?? host}
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        </a>
        {remove}
      </div>
    );
  }

  const site = preview.site_name || host;
  return (
    <div className={['poolse-link-preview', className].filter(Boolean).join(' ')}>
      <a
        className="poolse-link-preview__link"
        href={preview.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
      >
        {image ? (
          <img
            className="poolse-link-preview__image"
            src={preview.image_url!}
            alt=""
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        ) : null}
        <span className="poolse-link-preview__text">
          <span className="poolse-link-preview__site">
            {preview.favicon_url && isWebUrl(preview.favicon_url) && !faviconFailed ? (
              <img
                className="poolse-link-preview__favicon"
                src={preview.favicon_url}
                alt=""
                loading="lazy"
                onError={() => setFaviconFailed(true)}
              />
            ) : null}
            <span>{site}</span>
          </span>
          {preview.title ? (
            <span className="poolse-link-preview__title">{preview.title}</span>
          ) : null}
          {preview.description ? (
            <span className="poolse-link-preview__description">{preview.description}</span>
          ) : null}
        </span>
      </a>
      {remove}
    </div>
  );
}

/**
 * A message's previews, with the sender's × wired to
 * `messages.update(id, { remove_link_previews: [url] })`. The card goes
 * at once; it comes back if the server refuses.
 */
export function MessageLinkPreviews({
  message,
  canRemove,
}: {
  message: Message;
  canRemove: boolean;
}) {
  const chat = usePoolse();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const previews = (message.link_previews ?? []).filter((p) => !hidden.has(p.url));
  if (message.deleted_at || previews.length === 0) return null;

  const remove = (url: string) => {
    setHidden((prev) => new Set(prev).add(url));
    void chat.messages.update(message.id, { remove_link_previews: [url] }).catch(() => {
      setHidden((prev) => {
        const next = new Set(prev);
        next.delete(url);
        return next;
      });
    });
  };

  return (
    <div className="poolse-link-previews">
      {previews.map((p) => (
        <LinkPreviewCard
          key={p.url}
          preview={p}
          {...(canRemove ? { onRemove: () => remove(p.url) } : {})}
        />
      ))}
    </div>
  );
}

/** Whether a message has previews worth drawing. */
export function hasLinkPreviews(message: Message): boolean {
  return !message.deleted_at && (message.link_previews?.length ?? 0) > 0;
}

function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
