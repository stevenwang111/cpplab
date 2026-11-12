/**
 * Toolchain constants.
 *
 * The compiler itself is a WebAssembly build of LLVM/clang that the browser
 * downloads on demand. The version below is pinned together with the manifest
 * URL: the sysroot layout shipped by `@gameguild/emception-toolchain` is part
 * of the ABI our compile/link argv assumes, so both must move together.
 */

/** Pinned toolchain artifacts (brotli-compressed, lazily fetched per bundle). */
export const TOOLCHAIN_MANIFEST_URL =
  'https://cdn.jsdelivr.net/npm/@gameguild/emception-toolchain@4.5.2/cdn/manifest.json';

/** LLVM release inside the pinned toolchain; surfaced in the status bar. */
export const TOOLCHAIN_LLVM_VERSION = '23.0.0git';

/** Brotli payload of the minimal "compile + link C++ to wasm" bundle set. */
export const TOOLCHAIN_MIN_DOWNLOAD_MB = 41;

/** Where the emception VFS mounts the workspace. */
export const WORKSPACE_ROOT = '/home/user';

/**
 * Scratch directory for object files and the linked module.
 *
 * `/tmp` is the only writable directory that exists in the toolchain VFS before
 * the first process runs — clang cannot create directories itself, so `-o` into
 * a path like `/home/user/.cpplab/main.o` fails with "unable to open output
 * file". Keeping intermediates out of `/home/user` also stops them from showing
 * up next to the user's sources.
 */
export const OBJECT_DIR = '/tmp';

/** Linked WebAssembly module consumed by the runner worker. */
export const PROGRAM_PATH = '/tmp/program.wasm';

/** Bundles that must be warm before the first clang invocation. */
export const COMPILE_BUNDLES = ['llvm', 'libcurl-lite'] as const;

/** Source extensions that take part in the build. */
export const SOURCE_EXTENSIONS = ['.cpp', '.cc', '.cxx', '.c++', '.C', '.cp'] as const;

export function isSourceFile(path: string): boolean {
  return SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension));
}

export function hexId(bytes: number = 8): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (value) => value.toString(16).padStart(2, '0')).join('');
}
