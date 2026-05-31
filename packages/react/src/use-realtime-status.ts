import type { RealtimeStatus } from '@poolse/sdk';
import { useEffect, useState } from 'react';
import { usePoolse } from './provider.js';

/**
 * Connection status of the underlying WebSocket. Useful for showing a
 * "reconnecting…" banner without coupling to socket internals.
 *
 * Returns one of: `'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed'`.
 */
export function useRealtimeStatus(): RealtimeStatus {
  const chat = usePoolse();
  const [status, setStatus] = useState<RealtimeStatus>(chat.realtime.getStatus());

  useEffect(() => {
    setStatus(chat.realtime.getStatus());
    return chat.realtime.onStatus(setStatus);
  }, [chat]);

  return status;
}
