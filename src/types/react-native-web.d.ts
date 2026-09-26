// react-native-web ships no types. Only the one escape hatch the web time
// picker needs is declared here.
declare module 'react-native-web' {
  import type { ReactElement } from 'react';
  export function unstable_createElement(
    type: string,
    props?: Record<string, unknown>,
  ): ReactElement;
}
