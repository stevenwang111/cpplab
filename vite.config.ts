import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Cross-origin isolation headers.
 *
 * SharedArrayBuffer (used by the compiler worker's async strategy) requires
 * COOP + COEP. Hosts that cannot set headers still work through the
 * coi-serviceworker fallback injected at runtime, but serving these directly
 * avoids the one-time reload.
 */
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

/**
 * The toolchain packages declare `sideEffects: false`, but their worker entry
 * *is* all side effects: importing it installs the postMessage protocol. Flag
 * those modules as side-effectful per module; the `treeshake` option alone is
 * not enough because the declaration lives in the package manifest.
 */
function toolchainSideEffects(): Plugin {
  return {
    name: 'cpplab:toolchain-side-effects',
    moduleParsed(info) {
      if (info.id.includes('emception')) info.moduleSideEffects = true;
    },
  };
}

export default defineConfig({
  plugins: [react(), toolchainSideEffects()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4096,
  },
  server: {
    port: 5173,
    strictPort: true,
    headers: crossOriginIsolation,
  },
  preview: {
    port: 4173,
    strictPort: true,
    headers: crossOriginIsolation,
  },
  worker: {
    format: 'es',
    // Worker builds use their own plugin pipeline, so the side-effect fix has
    // to be registered there too.
    plugins: () => [toolchainSideEffects()],
  },
  optimizeDeps: {
    // The toolchain is a large ESM package whose worker entry must stay a real
    // module; pre-bundling it would break the Worker URL resolution.
    exclude: ['emception', '@gameguild/emception-browser'],
  },
});
