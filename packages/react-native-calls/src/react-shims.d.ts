// Minimal ambient declarations for the React / React Native surface this
// package touches, so it type-checks without either installed in the
// monorepo (the host app always supplies both). The emitted
// `dist/index.d.ts` imports the REAL types by module name, so consumers
// type-check against their own React Native — these shims never ship.
declare module 'react' {
  export interface ReactElement {
    type: unknown;
    props: unknown;
    key: string | null;
  }
  export type ComponentType<P = object> = (props: P) => ReactElement | null;
  export function createElement(type: unknown, props?: unknown, ...children: unknown[]): ReactElement;
}

declare module 'react-native' {
  export interface ViewProps {
    style?: unknown;
    testID?: string;
  }
  export const View: unknown;
}
