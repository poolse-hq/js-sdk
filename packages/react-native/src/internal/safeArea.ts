// The real safe-area hook, re-exported under the SDK's historical
// name.
//
// This used to lazy-require react-native-safe-area-context inside a
// try/catch "in case the host app lacks it" — but in the ESM bundle
// `require` doesn't exist at runtime, so the catch silently served
// hardcoded fallbacks instead: 34pt on iOS (coincidentally right for
// iPhones, which masked the bug) and 0 on Android, which put the
// composer underneath the navigation bar on every Android device.
// The library is a hard peer in practice, so this indirection
// protected nothing.
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface EdgeInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export const useSafeInsets: () => EdgeInsets = useSafeAreaInsets;
