/**
 * `edcore.main` ships the standalone editor entry point as JavaScript only
 * (the published typings live next to `editor.api`). Re-export the public API
 * types so `import * as monaco from '.../edcore.main'` is fully typed.
 */
declare module 'monaco-editor/esm/vs/editor/edcore.main' {
  export * from 'monaco-editor';
}
