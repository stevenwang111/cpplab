/**
 * F-06 regression probe: ensureRootfs() must refuse to follow symbolic links
 * planted at managed paths.
 *
 * Run with cwd pointed at a scratch dir that contains data/sandbox/rootfs, so
 * the imported config resolves the rootfs there:
 *   node_modules/.bin/tsx scripts/security-ensure-rootfs.mts <scratchDir>
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const scratch = process.argv[2];
if (!scratch) {
  console.error('usage: security-ensure-rootfs.mts <scratchDir>');
  process.exit(2);
}
process.chdir(scratch);

const { ensureRootfs } = await import('../src/server/sandbox/rootfs.js');

const root = path.join(scratch, 'data', 'sandbox', 'rootfs');
const canaryA = path.join(scratch, 'canary-a.txt');
const canaryB = path.join(scratch, 'canary-b.txt');
const hostDir = path.join(scratch, 'hostdir');

/** ensureRootfs leaves the tree read-only; restore write bits before removing. */
function makeWritable(dir: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      try {
        fs.chmodSync(full, 0o755);
      } catch {
        // Best effort.
      }
      makeWritable(full);
    } else {
      try {
        fs.chmodSync(full, 0o644);
      } catch {
        // Best effort.
      }
    }
  }
  try {
    fs.chmodSync(dir, 0o755);
  } catch {
    // Best effort.
  }
}

function resetRoot(): void {
  if (fs.existsSync(root)) makeWritable(root);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
}

// --- round 1: managed *directories* replaced by symlinks ------------------
resetRoot();
fs.writeFileSync(canaryA, 'CANARY_A\n', { mode: 0o600 });
fs.mkdirSync(hostDir, { recursive: true });
fs.writeFileSync(path.join(hostDir, 'passwd'), 'HOSTDATA\n');
fs.symlinkSync(hostDir, path.join(root, 'etc'));
fs.symlinkSync(hostDir, path.join(root, 'workspace'));

ensureRootfs();

assert.equal(
  fs.readFileSync(path.join(hostDir, 'passwd'), 'utf8'),
  'HOSTDATA\n',
  'round1: host file overwritten through a symlinked etc',
);
assert.ok(!fs.lstatSync(path.join(root, 'etc')).isSymbolicLink(), 'round1: rootfs/etc is still a symlink');
assert.ok(fs.lstatSync(path.join(root, 'etc', 'passwd')).isFile(), 'round1: etc/passwd is not a regular file');
assert.ok(
  fs.lstatSync(path.join(root, 'workspace')).isDirectory() &&
    !fs.lstatSync(path.join(root, 'workspace')).isSymbolicLink(),
  'round1: rootfs/workspace is not a real directory',
);

// --- round 2: managed *files* replaced by symlinks ------------------------
resetRoot();
fs.writeFileSync(canaryB, 'CANARY_B\n', { mode: 0o600 });
fs.mkdirSync(path.join(root, 'etc'), { recursive: true });
fs.symlinkSync(canaryB, path.join(root, 'etc', 'passwd'));
fs.symlinkSync(canaryB, path.join(root, 'etc', 'group'));

ensureRootfs();

assert.equal(fs.readFileSync(canaryB, 'utf8'), 'CANARY_B\n', 'round2: canary written through a symlinked file');
assert.ok(fs.lstatSync(path.join(root, 'etc', 'passwd')).isFile(), 'round2: etc/passwd is not a regular file');
assert.ok(fs.lstatSync(path.join(root, 'etc', 'group')).isFile(), 'round2: etc/group is not a regular file');

// Leave the scratch tree removable by the caller.
makeWritable(root);
fs.rmSync(root, { recursive: true, force: true });

console.log('ensure-rootfs symlink probe: PASS');
