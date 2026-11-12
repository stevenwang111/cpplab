/**
 * Bundled entry point for the in-browser compiler.
 *
 * Emception's worker entry installs the postMessage protocol, the VFS and the
 * LLVM toolchain inside this Worker. Owning the Worker here (instead of
 * letting the library spawn one) keeps the URL statically analysable, so Vite
 * can bundle the worker and its dependencies for the static build.
 */
import '@gameguild/emception-browser/worker';
