// Call chrome: the device menu (closed by its own button), the floating
// self-view, full screen support and the PiP window's theme.

import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CallControlButton, CallDeviceMenu } from '../src/CallControls.js';
import { CallVideoGrid } from '../src/CallVideoGrid.js';
import { CallPictureInPicture, type UsePictureInPicture } from '../src/PictureInPicture.js';
import { PoolseTheme } from '../src/PoolseTheme.js';
import { useFullscreen } from '../src/useFullscreen.js';

function Harness({ caret }: { caret: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <span className="callsheet__control">
        <CallControlButton
          icon="speaker-fill"
          label="Speaker"
          {...(caret
            ? { hasMenu: true, onClick: () => undefined, onMenuClick: () => setOpen((o) => !o) }
            : { opensMenu: true, onClick: () => setOpen((o) => !o) })}
        />
        {open && (
          <CallDeviceMenu
            title="Speaker"
            devices={[{ kind: 'audiooutput', deviceId: 'd1', label: 'Headphones' } as never]}
            onSelect={() => undefined}
            onClose={() => setOpen(false)}
          />
        )}
      </span>
      <p>Outside</p>
    </div>
  );
}

const press = (el: Element) => {
  fireEvent.mouseDown(el);
  fireEvent.click(el);
};

describe('CallDeviceMenu', () => {
  it('closes when its caret is pressed again', () => {
    render(<Harness caret />);
    press(screen.getByRole('button', { name: 'Speaker options' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    press(screen.getByRole('button', { name: 'Speaker options' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes when the button that opened it is pressed again', () => {
    render(<Harness caret={false} />);
    press(screen.getByRole('button', { name: 'Speaker' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    press(screen.getByRole('button', { name: 'Speaker' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('still closes on an outside click', () => {
    render(<Harness caret />);
    press(screen.getByRole('button', { name: 'Speaker options' }));
    press(screen.getByText('Outside'));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('floating self-view', () => {
  const person = (userId: string, isSelf: boolean) =>
    ({
      userId,
      name: userId,
      isSelf,
      micEnabled: true,
      metadata: {},
      speaking: false,
    }) as never;

  it('flips the camera on a tap, not on a stray release or a cancelled gesture', () => {
    // happy-dom has no pointer capture.
    const proto = HTMLElement.prototype as unknown as { setPointerCapture?: () => void };
    proto.setPointerCapture ??= () => undefined;
    const flip = vi.fn();
    render(
      <CallVideoGrid
        participants={[person('me', true), person('ana', false)]}
        onLocalClick={flip}
      />,
    );
    const tile = screen.getByRole('button', { name: /Your camera/ });
    // Pressed elsewhere, released on the tile.
    fireEvent.pointerUp(tile, { pointerId: 1 });
    // The browser took the gesture over.
    fireEvent.pointerDown(tile, { pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerCancel(tile, { pointerId: 1 });
    expect(flip).not.toHaveBeenCalled();
    fireEvent.pointerDown(tile, { pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(tile, { pointerId: 1, clientX: 5, clientY: 5 });
    expect(flip).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(tile, { key: 'Enter' });
    expect(flip).toHaveBeenCalledTimes(2);
  });
});

describe('useFullscreen', () => {
  it('is unsupported when the page may not go full screen, even with a fallback video', () => {
    const doc = document as unknown as { fullscreenEnabled?: boolean };
    const before = Object.getOwnPropertyDescriptor(document, 'fullscreenEnabled');
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false });
    try {
      const video = document.createElement('video');
      const { result } = renderHook(() => {
        const target = useRef<HTMLElement | null>(document.createElement('div'));
        const fallback = useRef<HTMLVideoElement | null>(video);
        return useFullscreen(target, fallback);
      });
      expect(doc.fullscreenEnabled).toBe(false);
      expect(result.current.supported).toBe(false);
    } finally {
      if (before) Object.defineProperty(document, 'fullscreenEnabled', before);
      else delete doc.fullscreenEnabled;
    }
  });
});

describe('CallPictureInPicture', () => {
  it('carries the PoolseTheme scheme and colours into the window', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const pip = { container } as unknown as UsePictureInPicture;
    render(
      <PoolseTheme theme="ocean" colorScheme="dark">
        <CallPictureInPicture pip={pip}>
          <span>tiles</span>
        </CallPictureInPicture>
      </PoolseTheme>,
    );
    const root = container.querySelector('.poolse-pip') as HTMLElement;
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(root.getAttribute('data-poolse-theme')).toBe('ocean');
    expect(root.getAttribute('style') ?? '').toContain('--');
    container.remove();
  });
});
