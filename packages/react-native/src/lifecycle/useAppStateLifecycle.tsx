import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { usePoolse } from '@poolse/react';

/**
 * Closes the SDK WebSocket cleanly when the app backgrounds and
 * reopens it when the app comes back to the foreground. Designed
 * to pair with push-notification delivery on the dev's backend —
 * iOS / Android suspend sockets aggressively, so we don't fight
 * the OS; we let the push wake the app and resync on resume.
 *
 * Mount once near the root of your app:
 *
 *     <PoolseProvider config={config}>
 *       <AppShell />
 *     </PoolseProvider>
 *
 *     function AppShell() {
 *       useAppStateLifecycle();
 *       return ...;
 *     }
 */
export function useAppStateLifecycle() {
  const poolse = usePoolse();

  useEffect(() => {
    let prev: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      const wasActive = prev === 'active';
      const isActive = next === 'active';

      if (wasActive && !isActive) {
        // Going to background — close the WS cleanly. The SDK's
        // realtime layer reopens lazily on the next subscription
        // call, so there's nothing to clean up state-side.
        try {
          poolse.realtime?.disconnect?.();
        } catch {
          // Older SDK builds may not expose disconnect; harmless.
        }
      } else if (!wasActive && isActive) {
        // Returning to foreground — the next hook render that
        // touches `realtime.conversation(...)` will reopen the
        // socket. `useMessages`/`useTyping`/`usePresence` all
        // refetch their starting snapshot on remount, so the active
        // conversation lands fresh.
        try {
          poolse.realtime?.connect?.();
        } catch {
          // Same compat note as above.
        }
      }

      prev = next;
    });

    return () => sub.remove();
  }, [poolse]);
}
