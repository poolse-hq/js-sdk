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
 */
export function useAppStateLifecycle() {
  const poolse = usePoolse();

  useEffect(() => {
    // Only 'background' pauses: iOS reports 'inactive' for the
    // notification centre or the app switcher, which is no reason to drop
    // the connection.
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'background') poolse.realtime.pause();
      else if (next === 'active') poolse.realtime.resume();
    });

    return () => sub.remove();
  }, [poolse]);
}
