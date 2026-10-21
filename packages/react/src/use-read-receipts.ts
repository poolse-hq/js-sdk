import type { Me } from '@poolse/sdk';
import { useCallback } from 'react';
import { usePoolse } from './provider.js';
import { useMe } from './use-me.js';

export interface UseReadReceipts {
  /**
   * Whether this user sees other people's read state. False → show no
   * check marks anywhere (the server withholds the data anyway).
   */
  visible: boolean;
  /** `on`, `off`, or `user` (each user decides) — the workspace setting. */
  mode: 'on' | 'off' | 'user';
  /** Whether others see when this user reads. */
  shared: boolean;
  /** True only when the workspace lets users decide: offer a switch. */
  canChange: boolean;
  /**
   * Turn this user's read receipts on or off (only where `canChange`).
   * Reciprocal: off also hides other people's.
   */
  setShared: (share: boolean) => Promise<void>;
}

/** The workspace's read-receipt setting as it applies to the signed-in user. */
export function useReadReceipts(): UseReadReceipts {
  const chat = usePoolse();
  const { me } = useMe();
  const state = receiptsOf(me);

  const setShared = useCallback(
    async (share: boolean) => {
      await chat.me.update({ read_receipts: share });
    },
    [chat],
  );

  return { ...state, setShared };
}

/** Read-receipt state from a `Me`; an older server without it means "on". */
export function receiptsOf(me: Me | null): Omit<UseReadReceipts, 'setShared'> {
  const r = me?.read_receipts;
  return {
    visible: r?.visible ?? true,
    mode: r?.mode ?? 'on',
    shared: r?.shared ?? true,
    canChange: r?.can_change ?? false,
  };
}

/** How long a message stays editable when read receipts are hidden. */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;

/**
 * May the viewer edit their own message? With read receipts visible:
 * until someone else has read it (`readState` is `read`), as in the
 * messaging apps. With them hidden there is nothing to show why editing
 * stopped, so it is a plain time window instead: 15 minutes from sending.
 */
export function canEditOwnMessage(args: {
  isSelf: boolean;
  deleted: boolean;
  receiptsVisible: boolean;
  readState: 'sent' | 'read' | undefined;
  insertedAt: string;
  now?: number;
}): boolean {
  if (!args.isSelf || args.deleted) return false;
  if (args.receiptsVisible) return (args.readState ?? 'sent') === 'sent';
  const sent = Date.parse(args.insertedAt);
  return Number.isFinite(sent) && (args.now ?? Date.now()) - sent < EDIT_WINDOW_MS;
}
