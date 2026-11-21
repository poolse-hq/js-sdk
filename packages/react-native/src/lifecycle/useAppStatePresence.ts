import { usePoolse } from '@poolse/react';
import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/**
 * Reports this device's activity for presence from `AppState`: the
 * app in the foreground → `presence.setActivity('active')`, in the
 * background (or iOS `inactive`: app switcher, notification centre) →
 * `'idle'`, so others see you as away. The SDK skips repeats.
 *
 * `<PoolseInbox>` and `useAppStateLifecycle()` already do this; call
 * it yourself only when you use neither. `enabled: false` turns it off.
 */
export function useAppStatePresence(enabled = true): void {
  const poolse = usePoolse();

  useEffect(() => {
    if (!enabled) return;
    const report = (state: AppStateStatus) => {
      try {
        poolse.presence.setActivity(state === 'active' ? 'active' : 'idle');
      } catch {
        // Presence is best-effort; an older server or a closed socket
        // must never break the app.
      }
    };
    report(AppState.currentState);
    const sub = AppState.addEventListener('change', report);
    return () => sub.remove();
  }, [poolse, enabled]);
}
