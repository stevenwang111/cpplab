/**
 * Capabilities of the client-only runtime.
 *
 * Nothing is probed on the server any more: the compiler is always the pinned
 * LLVM build, and what can vary is the browser environment (cross-origin
 * isolation for SharedArrayBuffer) and whether the clang-format artifact is
 * available in the toolchain bundle.
 */
import {
  COMPILERS,
  MAX_FILES,
  MAX_MEMORY_MB,
  MAX_OUTPUT_BYTES,
  MAX_RUN_TIME_MS,
  MAX_SOURCE_BYTES,
  MAX_STDIN_BYTES,
  OPTS,
  STDS,
  type Capabilities,
} from '../shared/types';
import { t } from './i18n';
import { TOOLCHAIN_LLVM_VERSION, TOOLCHAIN_MIN_DOWNLOAD_MB } from './wasm/constants';

export function isCrossOriginIsolated(): boolean {
  try {
    return typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
  } catch {
    return false;
  }
}

export function detectCapabilities(): Capabilities {
  const isolated = isCrossOriginIsolated();
  return {
    compilers: COMPILERS.map((id) => ({
      id,
      label: `clang++ · LLVM ${TOOLCHAIN_LLVM_VERSION}`,
      available: true,
      version: TOOLCHAIN_LLVM_VERSION,
    })),
    stds: [...STDS],
    opts: [...OPTS],
    toolchain: {
      driver: 'wasm',
      available: true,
      detail: t('app.toolchain.detail', { mb: TOOLCHAIN_MIN_DOWNLOAD_MB }),
      runtime: 'wasm32-wasi',
      crossOriginIsolated: isolated,
      llvmVersion: TOOLCHAIN_LLVM_VERSION,
    },
    tools: {
      formatter: false,
      debugger: false,
    },
    limits: {
      maxFiles: MAX_FILES,
      maxSourceBytes: MAX_SOURCE_BYTES,
      maxStdinBytes: MAX_STDIN_BYTES,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      maxRunTimeMs: MAX_RUN_TIME_MS,
      maxMemoryMb: MAX_MEMORY_MB,
    },
  };
}
