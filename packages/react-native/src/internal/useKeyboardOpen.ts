import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * True while the software keyboard is up.
 *
 * Surfaces use this to drop their bottom safe-area padding while the
 * keyboard covers the navigation bar / home indicator — otherwise the
 * inset shows up as a dead gap between the content and the keyboard.
 * iOS fires `Will*` events (lets the padding change ride the keyboard
 * animation); Android only reliably fires `Did*`.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setOpen(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setOpen(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return open;
}
