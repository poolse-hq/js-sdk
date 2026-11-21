import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { usePoolse } from '@poolse/react';

/**
 * Closes the SDK WebSocket when the app goes to the background and
 * reopens it when the app comes back. iOS and Android suspend sockets
 * in the background anyway; closing cleanly avoids a half-dead
 * connection on resume. poolse sends push notifications for messages
 * and calls itself, so nothing is lost while the socket is closed.
 *
 * Channel handles and their listeners survive the pause, so mounted
 * hooks keep working after resume, and `useMessages` /
 * `useConversations` reload from REST to catch up on what was sent
 * while the app was away.
 *
 * One workspace. With several signed in, use `useBackgroundClients`
 * instead (once, outside the providers) — it also keeps the workspaces
 * that aren't on screen disconnected.
 *
 * Mount once, inside the provider:
 *
 *     <PoolseProvider config={config}>
 *       <AppShell />
 *     </PoolseProvider>
 *
 *     function AppShell() {
 *       useAppStateLifecycle();
 *       return ...;
 *     }
 *
 * It also reports this device's activity for presence (foreground →
 * `active`, background / inactive → `idle`, which others see as away);
 * pass `{ presence: false }` to leave that to you.
 */
export function useAppStateLifecycle(options: { presence?: boolean } = {}) {
  const poolse = usePoolse();
  const presence = options.presence ?? true;

  useEffect(() => {
    const setActivity = (activity: 'active' | 'idle') => {
      if (!presence) return;
      try {
        poolse.presence.setActivity(activity);
      } catch {
        // Presence is best-effort.
      }
    };
    setActivity(AppState.currentState === 'active' ? 'active' : 'idle');
    // Only 'background' pauses: iOS reports 'inactive' for the
    // notification centre or the app switcher, which is no reason to drop
    // the connection. Idle is reported before the socket closes.
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background') {
        setActivity('idle');
        poolse.setBackground(true);
      } else if (next === 'active') {
        poolse.setBackground(false);
        setActivity('active');
      } else {
        setActivity('idle');
      }
    });

    return () => sub.remove();
  }, [poolse, presence]);
}
