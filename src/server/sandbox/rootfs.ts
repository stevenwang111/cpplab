import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const DEVICE_NAMES = ['null', 'zero', 'urandom', 'random'] as const;

const FAKE_PASSWD = [
  'root:x:0:0:root:/root:/bin/sh',
  'sandbox:x:10000:10000:Sandbox:/workspace:/bin/sh',
  '',
].join('\n');

const FAKE_GROUP = ['root:x:0:', 'sandbox:x:10000:', ''].join('\n');

/**
 * Build the minimal, read-only root filesystem shared by every jail. Only
 * /workspace and the tmpfs mounts are writable; the directory modes enforce
 * that even though nsjail itself runs with namespace root.
 */
export function ensureRootfs(): void {
  const root = config.sandbox.rootfsDir;
  fs.mkdirSync(root, { recursive: true, mode: 0o755 });
  makeWritable(root);

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
    fs.chmodSync(path.join(root, dir), 0o555);
  }
  for (const file of ['passwd', 'group', 'nsswitch.conf', 'hosts', 'resolv.conf', 'ld.so.cache', 'ld.so.conf', 'localtime']) {
    fs.chmodSync(path.join(root, 'etc', file), 0o444);
  }
  fs.chmodSync(root, 0o555);
  fs.chmodSync(path.join(root, 'workspace'), 0o777);
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
    if (fs.readFileSync(filePath, 'utf8') === content) return;
  } catch {
    // The file does not exist yet.
  }
  fs.writeFileSync(filePath, content, { mode: 0o444 });
}

export interface DeviceStatus {
  ready: boolean;
  missing: string[];
  detail: string;
}

/**
 * Device nodes are created once by scripts/setup-sandbox.sh. They live on the
 * host filesystem rather than /dev so their ownership can be mapped into the
 * sandbox user namespace; opening a foreign-owned device with O_CREAT fails on
 * this kernel.
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
    return { ready: true, missing, detail: '设备节点就绪' };
  }
  return {
    ready: false,
    missing,
    detail: `缺少设备节点 ${missing.join(', ')}；请运行 npm run sandbox:setup`,
  };
}
