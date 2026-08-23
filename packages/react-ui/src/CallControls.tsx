import type { CallDevice, CallDeviceKind } from '@poolse/sdk';
import { useEffect, useRef } from 'react';

import { PoolseIcon, type IconName } from './PoolseIcon.js';

export interface CallControlButtonProps {
  icon: IconName;
  /** Caption under the button, and the button's accessible name. */
  label: string;
  onClick: () => void;
  /**
   * The control is doing something — muted, camera off. Inverts the
   * button, so engaged controls are readable at a glance rather than
   * needing to be read one at a time.
   */
  active?: boolean;
  /** Paints the button solid: the hang-up and answer actions. */
  tone?: 'neutral' | 'danger' | 'accept';
  large?: boolean;
  disabled?: boolean;
  /** Renders the caret that marks a button as opening a menu. */
  hasMenu?: boolean;
  onMenuClick?: (() => void) | undefined;
}

/**
 * One round call control, matching `@poolse/react-native`'s
 * `CallControlButton` so the two platforms read the same.
 *
 * Ships no CSS — the host app owns the look, as everywhere else in this
 * package.
 */
export function CallControlButton({
  icon,
  label,
  onClick,
  active = false,
  tone = 'neutral',
  large = false,
  disabled = false,
  hasMenu = false,
  onMenuClick,
}: CallControlButtonProps) {
  const classes = [
    'callbtn',
    tone !== 'neutral' ? `callbtn--${tone}` : '',
    active ? 'callbtn--active' : '',
    large ? 'callbtn--large' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span className="callbtn__slot">
      <span className="callbtn__wrap">
        <button
          type="button"
          className={classes}
          onClick={onClick}
          disabled={disabled}
          aria-pressed={tone === 'neutral' ? active : undefined}
          aria-label={label}
        >
          <PoolseIcon name={icon} size={large ? 26 : 22} label={null} />
        </button>
        {hasMenu && (
          // A separate hit target, not a long-press: the toggle and the
          // device list are different actions, and hiding one inside a
          // timed gesture on the other is how people end up muting
          // themselves while trying to change microphone.
          <button
            type="button"
            className="callbtn__caret"
            onClick={onMenuClick}
            aria-label={`${label} options`}
          >
            <PoolseIcon name="chevron-up" size={13} label={null} />
          </button>
        )}
      </span>
      <span className="callbtn__label">{label}</span>
    </span>
  );
}

export interface CallDeviceMenuProps {
  title: string;
  devices: CallDevice[];
  /** Device id currently in use, if the browser reports one. */
  activeId?: string | undefined;
  onSelect: (kind: CallDeviceKind, deviceId: string) => void;
  onClose: () => void;
}

/**
 * Pick a camera, microphone or output.
 *
 * The web's counterpart to the mobile route sheet. A laptop has no
 * earpiece to switch to, but it does have three microphones and a pair
 * of headphones, and choosing between them is the same job.
 *
 * Renders nothing when there is nothing to choose between — a menu with
 * one entry is a dead end.
 */
export function CallDeviceMenu({
  title,
  devices,
  activeId,
  onSelect,
  onClose,
}: CallDeviceMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Dismiss on an outside click or Escape, which is what anyone who
  // opened this by accident mid-call will reach for.
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  if (devices.length === 0) return null;

  return (
    <div className="calldevices" ref={ref} role="menu" aria-label={title}>
      <p className="calldevices__title">{title}</p>
      {devices.map((device, index) => {
        const selected = device.deviceId === activeId;
        return (
          <button
            key={device.deviceId || `${device.kind}-${index}`}
            type="button"
            role="menuitemradio"
            aria-checked={selected}
            className={`calldevices__row${selected ? ' calldevices__row--on' : ''}`}
            onClick={() => {
              onSelect(device.kind, device.deviceId);
              onClose();
            }}
          >
            <span className="calldevices__name">
              {/* Labels are empty until the page holds a matching
                  permission — the browser withholds them so sites cannot
                  fingerprint devices. In a call that permission is held,
                  but a fallback beats a row of blanks. */}
              {device.label || `${kindLabel(device.kind)} ${index + 1}`}
            </span>
            {selected && <PoolseIcon name="check" size={16} label="selected" />}
          </button>
        );
      })}
    </div>
  );
}

function kindLabel(kind: CallDeviceKind): string {
  if (kind === 'videoinput') return 'Camera';
  if (kind === 'audioinput') return 'Microphone';
  return 'Output';
}
