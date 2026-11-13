import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./safari-version.mjs', import.meta.url));

const run = (...args) => {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  return { status: result.status, out: result.stdout, err: result.stderr };
};

describe('safari-version', () => {
  it('names the App Store version major.minor.<build>', () => {
    assert.deepEqual(run('0.1.3', '4308'), { status: 0, out: '0.1.4308\n', err: '' });
    assert.equal(run('1.0.0', '5000').out, '1.0.5000\n');
    assert.equal(run('2.7', '12').out, '2.7.12\n');
  });

  it('rises with the build, so a later release is a later App Store version', () => {
    const [a, b] = ['0.1.3', '0.1.4'].map((version, index) => run(version, String(4300 + index)).out.trim());
    const numbers = (version) => version.split('.').map(Number);
    assert.ok(numbers(b).every((part, index) => part >= numbers(a)[index]));
  });

  it('writes the build as a plain integer, so leading zeros never make two versions of one build', () => {
    assert.equal(run('0.1.3', '0007').out, '0.1.7\n');
  });

  it('refuses a version or build it cannot read', () => {
    for (const args of [['0.1.3'], ['0.1.3', 'x'], ['0.1.3', '4.3'], ['v0.1.3', '1'], ['1', '1'], []]) {
      const result = run(...args);
      assert.notEqual(result.status, 0, `accepted ${JSON.stringify(args)}`);
      assert.equal(result.out, '');
      assert.match(result.err, /usage: safari-version\.mjs/);
    }
  });
});
