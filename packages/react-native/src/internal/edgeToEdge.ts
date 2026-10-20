/**
 * Spread onto every SDK `<Modal>` so its Android window is edge-to-edge
 * like the host app (Expo SDK 54 / RN 0.81 enables edge-to-edge): the
 * modal then draws under both system bars on every device, and each
 * surface pads for `useSafeInsets()` itself. Without these the modal
 * window's bar handling differs by RN version and nav mode, so the
 * same padding would clear the nav bar on one phone and not another.
 *
 * `navigationBarTranslucent` arrived in RN 0.77 and the SDK still
 * type-checks against 0.76, hence a spread (no excess-prop check)
 * rather than JSX props. Older RN ignores the unknown prop.
 */
export const EDGE_TO_EDGE_MODAL = {
  statusBarTranslucent: true,
  navigationBarTranslucent: true,
} as const;
