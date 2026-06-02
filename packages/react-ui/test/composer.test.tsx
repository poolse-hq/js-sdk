import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MessageComposer } from '../src/MessageComposer.js';
import { renderWithProvider, scriptedFetch } from './_helpers.js';

// MessageComposer now uses useAttachmentUpload (for the paperclip +
// queue) which calls usePoolse — so every render needs a provider.
// A scripted fetch with an empty script is fine: these tests never
// trigger an attachment upload, so no fetch calls are made.
function renderComposer(ui: React.ReactElement) {
  return renderWithProvider(ui, scriptedFetch([]));
}

describe('<MessageComposer>', () => {
  it('renders an SVG send icon (not the word "Send")', () => {
    const { container } = renderComposer(<MessageComposer onSend={vi.fn()} />);
    const button = container.querySelector('.poolse-composer__send')!;
    expect(button.getAttribute('aria-label')).toBe('Send message');
    expect(button.querySelector('svg')).not.toBeNull();
    expect(button.textContent?.trim()).toBe('');
  });

  it('send button is disabled when input is empty', () => {
    const { container } = renderComposer(<MessageComposer onSend={vi.fn()} />);
    const button = container.querySelector('.poolse-composer__send') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('enables send button once user types', () => {
    const { container } = renderComposer(<MessageComposer onSend={vi.fn()} />);
    const input = container.querySelector('.poolse-composer__input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hi' } });
    const button = container.querySelector('.poolse-composer__send') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it('Enter without shift submits + clears input', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const { container } = renderComposer(<MessageComposer onSend={onSend} />);
    const input = container.querySelector('.poolse-composer__input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // The onSend is awaited inside submit(); flush microtasks.
    await new Promise((r) => setTimeout(r, 0));

    // Second arg is undefined when no `replyingTo` and no attachments
    // are set — the composer passes `(body, opts | undefined)` so a
    // quote-reply chip or attachment_ids can attach without changing
    // the call site.
    expect(onSend).toHaveBeenCalledWith('hello', undefined);
  });

  it('Shift+Enter does NOT submit', () => {
    const onSend = vi.fn();
    const { container } = renderComposer(<MessageComposer onSend={onSend} />);
    const input = container.querySelector('.poolse-composer__input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hi' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('onTyping fires on each keystroke', () => {
    const onTyping = vi.fn();
    const { container } = renderComposer(<MessageComposer onSend={vi.fn()} onTyping={onTyping} />);
    const input = container.querySelector('.poolse-composer__input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(input, { target: { value: 'ab' } });
    expect(onTyping).toHaveBeenCalledTimes(2);
  });
});
