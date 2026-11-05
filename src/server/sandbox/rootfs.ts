import fs from 'node:fs';
import path from 'node:path';
import { localized, type LocalizedText } from '../../shared/i18n/index.js';
import { config } from '../config.js';

const DEVICE_NAMES = ['null', 'zero', 'urandom', 'random'] as const;

const FAKE_PASSWD = [
  'root:x:0:0:root:/root:/bin/sh',
  `sandbox:x:${config.sandbox.uid}:${config.sandbox.gid}:Sandbox:/workspace:/bin/sh`,
  '',
].join('\n');

const FAKE_GROUP = ['root:x:0:', `sandbox:x:${config.sandbox.gid}:`, ''].join('\n');

/**
 * Build the minimal, read-only root filesystem shared by every jail. Only
 * /workspace and the tmpfs mounts are writable. The chroot is mounted read-only
 * (no --rw) and the tree is owned by the service user while the sandbox runs as
 * a disjoint uid, so the permission modes are defense-in-depth only.
 */
export function ensureRootfs(): void {
  const root = config.sandbox.rootfsDir;
  fs.mkdirSync(root, { recursive: true, mode: 0o755 });
  makeWritable(root);

  // F-06: drop any symlink planted at a managed location before a single
  // write or chmod can traverse it. Top-level entries first: removing a
  // symlinked parent makes the nested paths disappear with it.
  const managedPaths = [
    'usr',
    'etc',
    'dev',
    'proc',
    'tmp',
    'workspace',
    'run',
    'dev/pts',
    'dev/shm',
    'etc/ld.so.conf.d',
    'etc/passwd',
    'etc/group',
    'etc/nsswitch.conf',
    'etc/hosts',
    'etc/resolv.conf',
    'etc/ld.so.cache',
    'etc/ld.so.conf',
    'etc/localtime',
  ];
  for (const relative of managedPaths) {
    try {
      if (fs.lstatSync(path.join(root, relative)).isSymbolicLink()) {
        fs.unlinkSync(path.join(root, relative));
      }
    } catch {
      // Not present; it is created below.
    }
  }

  for (const dir of ['usr', 'etc', 'dev', 'dev/pts', 'dev/shm', 'proc', 'tmp', 'workspace', 'run']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true, mode: 0o755 });
  }
  fs.mkdirSync(path.join(root, 'etc', 'ld.so.conf.d'), { recursive: true, mode: 0o755 });

  ensureSymlink(path.join(root, 'bin'), 'usr/bin');
  ensureSymlink(path.join(root, 'sbin'), 'usr/sbin');
  ensureSymlink(path.join(root, 'lib'), 'usr/lib');
  ensureSymlink(path.join(root, 'lib64'), 'usr/lib64');

  writeIfDifferent(path.join(root, 'etc', 'passwd'), FAKE_PASSWD);
  writeIfDifferent(path.join(root, 'etc', 'group'), FAKE_GROUP);
  writeIfDifferent(path.join(root, 'etc', 'nsswitch.conf'), 'passwd: files\ngroup: files\nhosts: files\n');
  writeIfDifferent(path.join(root, 'etc', 'hosts'), '127.0.0.1 localhost\n::1 localhost\n');
  writeIfDifferent(path.join(root, 'etc', 'resolv.conf'), '');
  writeIfDifferent(path.join(root, 'etc', 'ld.so.cache'), '');
  writeIfDifferent(path.join(root, 'etc', 'ld.so.conf'), '');
  writeIfDifferent(path.join(root, 'etc', 'localtime'), '');

  // The rootfs is shared by every jail and must not be mutated by sandboxed
  // processes. The bind mounts remain independent of these modes.
  for (const dir of ['etc', 'etc/ld.so.conf.d', 'dev', 'dev/pts', 'dev/shm', 'proc', 'tmp', 'usr', 'run']) {
    chmodManaged(path.join(root, dir), 0o555);
  }
  for (const file of ['passwd', 'group', 'nsswitch.conf', 'hosts', 'resolv.conf', 'ld.so.cache', 'ld.so.conf', 'localtime']) {
    chmodManaged(path.join(root, 'etc', file), 0o444);
  }
  chmodManaged(root, 0o555);
  chmodManaged(path.join(root, 'workspace'), 0o777);
}

function makeWritable(root: string): void {
  const visit = (target: string): void => {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(target);
    } catch {
      return;
    }
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      try {
        fs.chmodSync(target, 0o755);
      } catch {
        // A root-owned tree is still usable when the process runs as root.
      }
      for (const entry of fs.readdirSync(target)) visit(path.join(target, entry));
    } else if (stat.isFile()) {
      try {
        fs.chmodSync(target, 0o644);
      } catch {
        // Ignore ownership mismatches; the file will be rewritten below.
      }
    }
  };
  visit(root);
}

function ensureSymlink(linkPath: string, target: string): void {
  try {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink() && fs.readlinkSync(linkPath) === target) return;
    if (stat.isDirectory()) fs.rmSync(linkPath, { recursive: true, force: true });
    else fs.unlinkSync(linkPath);
  } catch {
    // The link does not exist yet.
  }
  fs.symlinkSync(target, linkPath);
}

function writeIfDifferent(filePath: string, content: string): void {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) {
      // F-06: never follow an attacker-planted link into host territory.
      fs.unlinkSync(filePath);
    } else {
      if (stat.isFile() && fs.readFileSync(filePath, 'utf8') === content) return;
    }
  } catch {
    // The file does not exist yet.
  }
  const fd = fs.openSync(
    filePath,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW,
    0o444,
  );
  try {
    fs.writeFileSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }
}

/** chmod that refuses to follow symbolic links (F-06). */
function chmodManaged(target: string, mode: number): void {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) {
    // A symlink here is foreign material; drop it rather than chmod its target.
    fs.unlinkSync(target);
    return;
  }
  fs.chmodSync(target, mode);
}

export interface DeviceStatus {
  ready: boolean;
  missing: string[];
  /** Rendered per request locale by the capability layer. */
  detail: LocalizedText;
}

/**
 * Device nodes are created once by scripts/setup-sandbox.sh. They live on the
 * host filesystem rather than /dev and are owned by the sandbox uid: this
 * kernel rejects open(O_CREAT) on a foreign-owned device node with EACCES,
 * and lldb's launcher opens /dev/null with O_CREAT for the debuggee's stdio.
 */
export function checkDevices(): DeviceStatus {
  const missing: string[] = [];
  for (const name of DEVICE_NAMES) {
    const target = path.join(config.sandbox.devDir, name);
    try {
      const stat = fs.statSync(target);
      if (!stat.isCharacterDevice()) missing.push(name);
      fs.accessSync(target, fs.constants.R_OK | fs.constants.W_OK);
    } catch {
      missing.push(name);
    }
  }
  if (missing.length === 0) {
    return { ready: true, missing, detail: localized('caps.devicesReady') };
  }
  return {
    ready: false,
    missing,
    detail: localized('caps.devicesMissing', { list: missing.join(', ') }),
  };
}
