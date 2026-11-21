import { Poolse, type PoolseConfig, type TrackActivityOptions } from '@poolse/sdk';
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { ConversationsStore } from './conversations-store.js';

interface PoolseContextValue {
  chat: Poolse;
  /** The conversation list every `useConversations()` shares. */
  conversations: ConversationsStore;
}

const PoolseContext = createContext<PoolseContextValue | null>(null);

export interface PoolseProviderProps {
  /**
   * SDK configuration. The provider builds the `Poolse` instance ONCE
   * per mount and reads `getToken` (and the other function-typed
   * options) from a ref on each call, so it's safe to pass a fresh
   * callback or a fresh object literal on every render.
   *
   * Re-mount the provider (give it a new `key`) when you genuinely
   * want a fresh client — typically after a sign-out, a tenant swap,
   * or an `apiUrl` change. Mutating `apiUrl` / `wsUrl` / `socketPath`
   * after mount is a no-op (the values are captured at construction
   * time); dev mode logs a warning when this happens.
   */
  config: PoolseConfig;
  /**
   * Report this device `active` / `idle` for presence from the browser
   * (`poolse.presence.trackActivity`): idle while the page is hidden,
   * the window is blurred, or after 5 minutes without input. On by
   * default; does nothing without a `document` (React Native — call
   * `usePoolse().presence.setActivity()` from `AppState` there). Pass
   * `false` to report yourself, or options (`{ idleAfterMs }`). Read at
   * mount.
   */
  trackActivity?: boolean | Omit<TrackActivityOptions, 'document' | 'window'>;
  children: ReactNode;
}

/**
 * Top-level provider. Wrap your tree once with this; every hook in
 * `@poolse/react` reads from the context.
 *
 * ```tsx
 * <PoolseProvider config={{apiUrl, getToken}}>
 *   <App />
 * </PoolseProvider>
 * ```
 *
 * The `Poolse` instance is destroyed on unmount — closes the WebSocket
 * and drops every joined channel.
 */
export function PoolseProvider({ config, trackActivity = true, children }: PoolseProviderProps) {
  // Hold the latest config in a ref so the SDK reads current callbacks
  // without us rebuilding the client. Without this, the standard call
  // site `<Provider config={{apiUrl, getToken}}>` re-creates `Poolse`
  // on every parent render — closing the socket mid-flight and
  // re-firing every REST call. Refs let us keep ONE SDK instance per
  // mount while still honoring a freshly-bound `getToken` closed over
  // new auth state.
  const configRef = useRef(config);
  configRef.current = config;

  // Captured at mount for the dev-mode change warning below.
  const initialConnectionRef = useRef<{
    apiUrl: string | undefined;
    wsUrl: string | undefined;
    socketPath: string | undefined;
  } | null>(null);

  const chat = useMemo(() => {
    const initial = configRef.current;
    initialConnectionRef.current = {
      apiUrl: initial.apiUrl,
      wsUrl: initial.wsUrl,
      socketPath: initial.socketPath,
    };
    return new Poolse({
      // apiUrl is optional in PoolseConfig — only forward when set
      // so the SDK can fall back to its hosted-endpoint default.
      ...(initial.apiUrl !== undefined ? { apiUrl: initial.apiUrl } : {}),
      // Always read the latest callbacks from the ref — they're free
      // to change between renders.
      getToken: () => configRef.current.getToken(),
      ...(initial.fetch
        ? { fetch: ((...args) => configRef.current.fetch!(...args)) as typeof globalThis.fetch }
        : {}),
      ...(initial.maxRetries !== undefined ? { maxRetries: initial.maxRetries } : {}),
      ...(initial.baseBackoffMs !== undefined ? { baseBackoffMs: initial.baseBackoffMs } : {}),
      ...(initial.maxBackoffMs !== undefined ? { maxBackoffMs: initial.maxBackoffMs } : {}),
      ...(initial.generateIdempotencyKey
        ? { generateIdempotencyKey: () => configRef.current.generateIdempotencyKey!() }
        : {}),
      ...(initial.wsUrl !== undefined ? { wsUrl: initial.wsUrl } : {}),
      ...(initial.socketPath !== undefined ? { socketPath: initial.socketPath } : {}),
      ...(initial.onSocketError
        ? { onSocketError: (err) => configRef.current.onSocketError!(err) }
        : {}),
      // Customer's user metadata resolver — name + avatar lookup.
      // Read through the ref so the customer can swap the closure
      // (e.g. switch tenant context) without re-mounting.
      ...(initial.userResolver
        ? { userResolver: (id: string) => configRef.current.userResolver!(id) }
        : {}),
    });
    // Mount-once: the `Poolse` instance owns a WebSocket and channel
    // subscriptions, so it MUST be stable for the life of the mount.
    // Changing `apiUrl` / `wsUrl` / `socketPath` requires a remount.
  }, []);

  // Surface mistakes early in dev: connection-shaped fields are
  // captured at construction time, so changing them after mount has
  // no effect (callbacks like `getToken` ARE re-read from the ref).
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      const initial = initialConnectionRef.current;
      if (!initial) return;
      if (
        initial.apiUrl !== config.apiUrl ||
        initial.wsUrl !== config.wsUrl ||
        initial.socketPath !== config.socketPath
      ) {
        console.warn(
          '[poolse] connection-shaped config (apiUrl / wsUrl / socketPath) ' +
            'changed after <PoolseProvider> mounted. These are captured at ' +
            'construction time — remount the provider with a new `key` to ' +
            'switch environments.',
        );
      }
    }, [config.apiUrl, config.wsUrl, config.socketPath]);
  }

  useEffect(() => {
    return () => {
      chat.destroy();
    };
  }, [chat]);

  // Read at mount: the options object may be a fresh literal each render.
  const trackActivityRef = useRef(trackActivity);
  useEffect(() => {
    const opts = trackActivityRef.current;
    if (opts === false) return;
    return chat.presence.trackActivity(opts === true ? {} : opts);
  }, [chat]);

  const value = useMemo(() => ({ chat, conversations: new ConversationsStore(chat) }), [chat]);

  return <PoolseContext.Provider value={value}>{children}</PoolseContext.Provider>;
}

/**
 * Access the underlying `Poolse` instance. Most app code should prefer
 * higher-level hooks (`useMessages`, `useTyping`, etc.) but the raw
 * client is here for escape-hatch usage (custom REST calls, direct
 * realtime control).
 */
export function usePoolse(): Poolse {
  return usePoolseContext('usePoolse').chat;
}

/**
 * The conversation-list store shared under this provider.
 *
 * @internal Used by `useConversations` and `useMessages`.
 */
export function useConversationsStore(): ConversationsStore {
  return usePoolseContext('useConversations').conversations;
}

function usePoolseContext(hook: string): PoolseContextValue {
  const value = useContext(PoolseContext);

  if (!value) {
    throw new Error(
      `${hook}(): no <PoolseProvider> in the tree. Wrap your component ` +
        'with `<PoolseProvider config={{apiUrl, getToken}}>` first.',
    );
  }

  return value;
}
