import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { removeDir } from './helpers/fs-utils.js';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { probeCli } from '../src/main/cli-discovery.js';

test('probes an explicit native executable without passing a null Node command', async (t) => {
  const root = path.resolve('work', `cli-test-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  t.after(() => removeDir(root));
  const executable = path.join(root, 'codex.exe');
  await writeFile(executable, 'placeholder');
  let invocation;
  const result = await probeCli('codex', executable, async (file, args) => {
    invocation = { file, args };
    return { stdout: 'codex-cli 9.0.0\n' };
  });
  assert.deepEqual(invocation, { file: executable, args: ['--version'] });
  assert.equal(result.version, 'codex-cli 9.0.0');
  assert.equal(result.connected, true);
});
