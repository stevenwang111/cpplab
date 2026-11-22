#!/usr/bin/env node
/**
 * Local account administration. This is the primary management path in the
 * account administration; there is no public registration.
 *
 * Usage:
 *   npm run user:add -- alice --admin
 *   npm run user:add -- bob --password 'correct horse battery'
 *   npm run user:list
 *   npm run user:passwd -- alice
 *   npm run user:disable -- bob
 *   npm run user:enable -- bob
 *   npm run user:role -- bob admin
 *
 * Pass DB_PATH to operate on a non-default database (the smoke test does this).
 */
import process from 'node:process';
import {
  countOrphanProjects,
  countUsers,
  createUser,
  getUserByUsername,
  initDb,
  listUsers,
  getProjectForUser,
  revokeUserAuthSessions,
  setUserRole,
  setUserStatus,
  toAdminUser,
  updateUserPassword,
} from '../src/server/db.js';
import {
  generateOneTimePassword,
  hashPassword,
} from '../src/server/auth/password.js';

const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$/;

function usage(): never {
  console.log(`Usage:
  user-cli add <username> [--admin] [--password <pw>] [--display-name <name>]
  user-cli list
  user-cli passwd <username>
  user-cli disable <username>
  user-cli enable <username>
  user-cli role <username> <admin|user>

The service should be stopped (or at least idle) while accounts are changed.`);
  process.exit(2);
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function promptHidden(label: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const data = await readStdin();
    return data.split(/\r?\n/)[0] ?? '';
  }
  return new Promise((resolve, reject) => {
    process.stdout.write(label);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const cleanup = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stdout.write('\n');
    };
    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (char === '\u0003') {
          cleanup();
          reject(new Error('cancelled'));
          return;
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };
    stdin.on('data', onData);
  });
}

async function readPassword(provided: string | undefined): Promise<string> {
  if (provided !== undefined) return provided;
  if (!process.stdin.isTTY) {
    // Piped input carries both lines at once; read them together instead of
    // letting the first prompt consume EOF and the second see nothing.
    const lines = (await readStdin()).split(/\r?\n/);
    const first = lines[0] ?? '';
    const again = lines[1] ?? first;
    if (first !== again) throw new Error('passwords do not match');
    return first;
  }
  const first = await promptHidden('Password: ');
  const again = await promptHidden('Repeat password: ');
  if (first !== again) throw new Error('passwords do not match');
  return first;
}

function requireUsername(value: string | undefined): string {
  if (!value || !USERNAME_PATTERN.test(value)) {
    throw new Error('username must be 3-32 letters, digits, underscores, dots or dashes');
  }
  return value;
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args[index + 1];
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) usage();
  initDb();

  switch (command) {
    case 'add': {
      const username = requireUsername(rest.find((arg) => !arg.startsWith('--')));
      if (getUserByUsername(username)) throw new Error(`user ${username} already exists`);
      const admin = rest.includes('--admin');
      const password = await readPassword(optionValue(rest, '--password'));
      if (password.length < 10) throw new Error('password must be at least 10 characters');
      const passwordHash = await hashPassword(password);
      const created = createUser({
        username,
        displayName: optionValue(rest, '--display-name') ?? username,
        passwordHash,
        role: admin ? 'admin' : 'user',
        mustChangePassword: false,
      });
      const project = getProjectForUser(created.user.id);
      console.log(`created ${admin ? 'admin' : 'user'} ${created.user.username} (${created.user.id})`);
      if (created.adopted > 0) console.log(`adopted ${created.adopted} legacy project(s)`);
      if (project) console.log(`project ${project.id}`);
      break;
    }
    case 'list': {
      const users = listUsers().map(toAdminUser);
      if (users.length === 0) {
        console.log('no users; create one with `npm run user:add -- <name> --admin`');
        break;
      }
      for (const user of users) {
        const flags = [user.role, user.status, user.mustChangePassword ? 'must-change' : ''].filter(Boolean);
        console.log(`${user.username.padEnd(24)} ${user.id}  ${flags.join(' ')}`);
      }
      break;
    }
    case 'passwd': {
      const username = requireUsername(rest.find((arg) => !arg.startsWith('--')));
      const user = getUserByUsername(username);
      if (!user) throw new Error(`user ${username} not found`);
      const password = generateOneTimePassword();
      updateUserPassword(user.id, await hashPassword(password), true);
      const revoked = revokeUserAuthSessions(user.id);
      console.log(`reset password for ${user.username} (revoked ${revoked} session(s))`);
      console.log('one-time password (shown once, must be changed at next login):');
      console.log(password);
      break;
    }
    case 'disable':
    case 'enable': {
      const username = requireUsername(rest.find((arg) => !arg.startsWith('--')));
      const user = getUserByUsername(username);
      if (!user) throw new Error(`user ${username} not found`);
      if (rest.includes('--admin') || user.role === 'admin') {
        const admins = listUsers().filter((item) => item.role === 'admin' && item.status === 'active');
        if (command === 'disable' && admins.length <= 1 && user.status === 'active') {
          throw new Error('refusing to disable the last active administrator');
        }
      }
      setUserStatus(user.id, command === 'disable' ? 'disabled' : 'active');
      if (command === 'disable') revokeUserAuthSessions(user.id);
      console.log(`${command}d ${user.username}`);
      break;
    }
    case 'role': {
      const username = requireUsername(rest[0]);
      const role = rest[1];
      if (role !== 'admin' && role !== 'user') usage();
      const user = getUserByUsername(username);
      if (!user) throw new Error(`user ${username} not found`);
      if (role === 'user' && user.role === 'admin') {
        const admins = listUsers().filter((item) => item.role === 'admin' && item.status === 'active');
        if (admins.length <= 1) throw new Error('refusing to demote the last active administrator');
      }
      setUserRole(user.id, role);
      console.log(`${user.username} is now ${role}`);
      break;
    }
    default:
      usage();
  }

  if (countUsers() === 0) console.log('note: the users table is still empty');
  if (countOrphanProjects() > 0) {
    console.log(`warning: ${countOrphanProjects()} project(s) still have no owner`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
