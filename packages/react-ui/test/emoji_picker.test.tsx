import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmojiPicker, MessageComposer, ReactionPicker } from '../src/index.js';
import { renderWithProvider, scriptedFetch } from './_helpers.js';

describe('<EmojiPicker>', () => {
  it('loads its data lazily and shows the categories', async () => {
    const { container } = render(<EmojiPicker onPick={vi.fn()} />);
    await waitFor(() =>
      expect(container.querySelectorAll('[data-emoji-section]').length).toBeGreaterThan(5),
    );
    expect(container.querySelectorAll('.poolse-emoji-picker__tab').length).toBeGreaterThan(5);
    expect(document.activeElement).toBe(container.querySelector('input[type="search"]'));
  });

  it('searches by name and keyword; Enter picks the first hit; picks become recent', async () => {
    const onPick = vi.fn();
    const { container, unmount } = render(<EmojiPicker onPick={onPick} />);
    await waitFor(() => expect(container.querySelector('[data-emoji-section]')).not.toBeNull());
    const search = container.querySelector('input[type="search"]')!;
    fireEvent.change(search, { target: { value: 'thumbs up' } });
    expect(container.querySelector('.poolse-emoji-picker__emoji')?.textContent).toBe('👍');
    fireEvent.change(search, { target: { value: 'tada' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith('🎉');
    fireEvent.change(search, { target: { value: 'zzzz-nothing' } });
    expect(container.textContent).toContain('No emoji found');
    unmount();

    const again = render(<EmojiPicker onPick={vi.fn()} />);
    await waitFor(() =>
      expect(again.container.querySelector('[data-emoji-section="recent"]')?.textContent).toContain(
        '🎉',
      ),
    );
  });

  it('Escape closes', async () => {
    const onClose = vi.fn();
    const { container } = render(<EmojiPicker onPick={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(container.querySelector('.poolse-emoji-picker')!, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('<ReactionPicker> "+"', () => {
  it('opens the full picker', async () => {
    const onPick = vi.fn();
    const { container } = render(<ReactionPicker onPick={onPick} />);
    fireEvent.click(container.querySelector('[aria-label="More emoji"]')!);
    await waitFor(() => expect(container.querySelector('[data-emoji-section]')).not.toBeNull());
    fireEvent.change(container.querySelector('input[type="search"]')!, {
      target: { value: 'rocket' },
    });
    fireEvent.click(container.querySelector('.poolse-emoji-picker__emoji')!);
    expect(onPick).toHaveBeenCalledWith('🚀');
  });
});

describe('composer emoji button', () => {
  it('inserts the emoji at the caret', async () => {
    const { container } = renderWithProvider(
      <MessageComposer onSend={vi.fn()} />,
      scriptedFetch([]),
    );
    const input = container.querySelector('textarea')!;
    fireEvent.change(input, { target: { value: 'hi there' } });
    input.setSelectionRange(2, 2);
    fireEvent.click(container.querySelector('[aria-label="Insert emoji"]')!);
    await waitFor(() => expect(container.querySelector('[data-emoji-section]')).not.toBeNull());
    fireEvent.change(container.querySelector('input[type="search"]')!, {
      target: { value: 'waving hand' },
    });
    fireEvent.click(container.querySelector('.poolse-emoji-picker__emoji')!);
    expect(input.value).toBe('hi👋 there');
    expect(container.querySelector('.poolse-emoji-picker')).toBeNull();
  });

  it('emojiPicker={false} drops the button', () => {
    const { container } = renderWithProvider(
      <MessageComposer onSend={vi.fn()} emojiPicker={false} />,
      scriptedFetch([]),
    );
    expect(container.querySelector('[aria-label="Insert emoji"]')).toBeNull();
  });
});
