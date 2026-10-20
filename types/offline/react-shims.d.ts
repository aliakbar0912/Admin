// OFFLINE TYPE SHIMS, used only by tsconfig.offline.json where @types/react cannot be installed.
// The real typecheck (npm run typecheck, after npm ci) uses the published type packages instead.
declare module 'react' {
  export type ReactNode = any;
  export type FormEvent<T = Element> = { preventDefault(): void; currentTarget: T; target: any };
  export function useState<S>(initial: S | (() => S)): [S, (value: S | ((prev: S) => S)) => void];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useId(): string;
}
declare module 'react/jsx-runtime' {
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
}
declare module 'react-dom/client' {
  export function createRoot(container: Element): { render(node: any): void };
}
declare module '*.css';
declare namespace JSX {
  interface Element {}
  interface IntrinsicAttributes {
    key?: any;
  }
  interface IntrinsicElements {
    [element: string]: any;
  }
}
