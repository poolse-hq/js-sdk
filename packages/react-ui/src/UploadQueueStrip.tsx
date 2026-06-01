import type { UploadItem } from '@poolse/react';
import { PoolseIcon } from './PoolseIcon.js';

interface UploadQueueStripProps {
  items: UploadItem[];
  onCancel: (localId: string) => void;
  onDismiss: (localId: string) => void;
}

/**
 * Strip of pending / uploading / errored attachments shown above the
 * composer. Ready items aren't included — they get cleared by the
 * parent once the send completes.
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
  const isInFlight = item.status === 'pending' || item.status === 'uploading';
  return (
    <div
      className={`poolse-upload-chip poolse-upload-chip--${item.status}`}
      data-status={item.status}
    >
      <div className="poolse-upload-chip__icon" aria-hidden="true">
        <PoolseIcon name={isError ? 'attachment' : 'attachment'} size={18} label={null} />
      </div>
      <div className="poolse-upload-chip__body">
        <div className="poolse-upload-chip__filename" title={item.filename}>
          {item.filename}
        </div>
        {isError ? (
          <div className="poolse-upload-chip__error">
            {item.error?.message ?? 'Upload failed'}
          </div>
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
        aria-label={isInFlight ? `Cancel upload of ${item.filename}` : `Dismiss ${item.filename}`}
        title={isInFlight ? 'Cancel' : 'Dismiss'}
      >
        ×
      </button>
    </div>
  );
}
