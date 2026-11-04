#!/usr/bin/env bash
# Prepare the host-side pieces the sandbox needs: nsjail, LLDB, clang-format and
# the device nodes bound into every jail. Safe to run more than once.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "${EUID}" -eq 0 ]]; then
  SUDO=()
elif [[ "${SUDO_NONINTERACTIVE:-0}" == "1" ]]; then
  SUDO=(sudo -n)
else
  SUDO=(sudo)
fi

need_cmd() { command -v "$1" >/dev/null 2>&1; }

echo "[1/4] Install build/debug/sandbox dependencies"
PACKAGES=(clang clang-format lldb time dumb-init build-essential libprotobuf-dev protobuf-compiler libnl-3-dev libnl-route-3-dev libcap-dev bison flex pkg-config uidmap git)
MISSING=()
for pkg in "${PACKAGES[@]}"; do
  if ! dpkg -s "$pkg" >/dev/null 2>&1; then MISSING+=("$pkg"); fi
done
if ((${#MISSING[@]})); then
  "${SUDO[@]}" apt-get update
  "${SUDO[@]}" apt-get install -y --no-install-recommends "${MISSING[@]}"
fi

echo "[2/4] Prepare nsjail"
NSJAIL="$(command -v nsjail || true)"
if [[ -z "$NSJAIL" ]]; then
  BUILD_DIR="$ROOT/.build/nsjail"
  if [[ ! -x "$BUILD_DIR/nsjail" ]]; then
    mkdir -p "$ROOT/.build"
    if [[ ! -d "$BUILD_DIR/.git" ]]; then
      rm -rf "$BUILD_DIR"
      git clone --depth 1 --recursive https://github.com/google/nsjail.git "$BUILD_DIR"
    fi
    make -C "$BUILD_DIR" -j"$(nproc)"
  fi
  "${SUDO[@]}" install -m 4755 "$BUILD_DIR/nsjail" /usr/local/bin/nsjail
  NSJAIL=/usr/local/bin/nsjail
fi
if [[ "${EUID}" -ne 0 ]]; then
  # nsjail needs namespace setup privileges. The setuid bit lets the backend,
  # which runs as the ordinary login user, create a jail without a root daemon.
  "${SUDO[@]}" chown root:root "$NSJAIL"
  "${SUDO[@]}" chmod 4755 "$NSJAIL"
fi
echo "      nsjail: $NSJAIL"

echo "[3/4] Create sandbox device nodes"
DEV_DIR="$ROOT/data/sandbox/dev"
"${SUDO[@]}" mkdir -p "$DEV_DIR"
"${SUDO[@]}" chown -R "$(id -u):$(id -g)" "$ROOT/data/sandbox"
create_device() {
  local name="$1" major="$2" minor="$3"
  local target="$DEV_DIR/$name"
  if [[ -c "$target" ]]; then
    "${SUDO[@]}" chown "$(id -u):$(id -g)" "$target"
    "${SUDO[@]}" chmod 666 "$target"
    return
  fi
  "${SUDO[@]}" mknod -m 666 "$target" c "$major" "$minor"
  "${SUDO[@]}" chown "$(id -u):$(id -g)" "$target"
}
create_device null 1 3
create_device zero 1 5
create_device urandom 1 9
create_device random 1 8
ls -l "$DEV_DIR"

echo "[4/4] Check tools"
for tool in g++ clang-format lldb-dap nsjail; do
  if command -v "$tool" >/dev/null 2>&1; then
    printf '      %-14s %s\n' "$tool" "$(command -v "$tool")"
  else
    printf '      %-14s MISSING\n' "$tool"
  fi
done

mkdir -p "$ROOT/data/runtime/logs" "$ROOT/data/sandbox/rootfs"
echo "Done. After starting the backend, open http://127.0.0.1:3000 (or http://127.0.0.1:5173 in development mode)."
echo "Note: nsjail is installed setuid root; only use it on a local single-user / intranet setup."
