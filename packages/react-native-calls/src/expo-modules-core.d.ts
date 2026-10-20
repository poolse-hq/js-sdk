// Minimal ambient declaration for the one `expo-modules-core` function
// this package calls at runtime. It lets the package type-check and emit
// its own `.d.ts` without `expo-modules-core`'s full types installed in
// the monorepo — the host app always supplies the real module at runtime.
//
// This shim lives only in the package source; consumers read the emitted
// `dist/index.d.ts`, which never references `expo-modules-core`, so it
// cannot collide with the app's own copy of the types.
declare module 'expo-modules-core' {
  export function requireOptionalNativeModule<T>(name: string): T | null;
  /** A native view registered by an Expo module (`View(...)` + `Name(...)`). */
  export function requireNativeViewManager<P>(
    moduleName: string,
    viewName?: string,
  ): import('react').ComponentType<P>;
}
