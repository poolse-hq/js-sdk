import type { UploadItem } from '@poolse/react';
import { PoolseIcon } from './PoolseIcon.js';

interface UploadQueueStripProps {
  items: UploadItem[];
  onCancel: (localId: string) => void;
  onDismiss: (localId: string) => void;
}

/**
 * Strip of staged attachments shown above the composer — pending,
 * uploading, ready (waiting for the user to hit send), or errored.
 * Ready chips are the user's signal that "these will go out when I
 * press send" — the composer parent sweeps them out only after the
 * send completes successfully.
 */
export function UploadQueueStrip({ items, onCancel, onDismiss }: UploadQueueStripProps) {
  if (items.length === 0) return null;
  return (
    <div className="poolse-upload-strip" role="status" aria-live="polite">
      {items.map((item) => (
        <UploadChip
          key={item.localId}
          item={item}
          onCancel={() => onCancel(item.localId)}
          onDismiss={() => onDismiss(item.localId)}
        />
      ))}
    </div>
  );
}

function UploadChip({
  item,
  onCancel,
  onDismiss,
}: {
  item: UploadItem;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  const pct =
    item.byteSize > 0 ? Math.min(100, Math.round((item.loaded / item.byteSize) * 100)) : 0;
  const isError = item.status === 'error';
  const isReady = item.status === 'ready';
  const isInFlight = item.status === 'pending' || item.status === 'uploading';
  return (
    <div
      className={`poolse-upload-chip poolse-upload-chip--${item.status}`}
      data-status={item.status}
    >
      <div className="poolse-upload-chip__icon" aria-hidden="true">
        <PoolseIcon name={isReady ? 'check' : 'attachment'} size={18} label={null} />
      </div>
      <div className="poolse-upload-chip__body">
        <div className="poolse-upload-chip__filename" title={item.filename}>
          {item.filename}
        </div>
        {isError ? (
          <div className="poolse-upload-chip__error">
            {item.error?.message ?? 'Upload failed'}
          </div>
        ) : isReady ? (
          // No progress bar once the upload is done — the chip itself
          // is the "staged, waiting on send" signal. A short caption
          // makes that explicit for screen-readers + glance-readers.
          <div className="poolse-upload-chip__ready-label">Ready to send</div>
        ) : (
          <div
            className="poolse-upload-chip__bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label={`Uploading ${item.filename}`}
          >
            <div className="poolse-upload-chip__bar-fill" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <button
        type="button"
        className="poolse-upload-chip__action"
        onClick={isInFlight ? onCancel : onDismiss}
        aria-label={
          isInFlight
            ? `Cancel upload of ${item.filename}`
            : isReady
              ? `Remove ${item.filename}`
              : `Dismiss ${item.filename}`
        }
        title={isInFlight ? 'Cancel' : isReady ? 'Remove' : 'Dismiss'}
      >
        ×
      </button>
    </div>
  );
}
