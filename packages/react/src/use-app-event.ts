import type { AppEvent } from '@poolse/sdk';
import { useEffect, useRef } from 'react';
import { usePoolse } from './provider.js';

/**
 * Run `handler` for every app-defined event sent to the signed-in user
 * (`app:event`: `{ type, data }`) — e.g. the Workspace API's
 * `member:updated` or `workspace:updated`. A thin wrapper over
 * `chat.onAppEvent`; the handler may change between renders.
 *
 * Profiles named by `member:updated` are refreshed for you; this is
 * for anything else your app wants to do.
 */
export function useAppEvent(handler: (evt: AppEvent) => void): void {
  const chat = usePoolse();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => chat.onAppEvent((evt) => handlerRef.current(evt)), [chat]);
}
