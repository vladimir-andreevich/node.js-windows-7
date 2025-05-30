'use strict';

require('../common');
const assert = require('assert');
const { spawnSync } = require('child_process');
const { join } = require('path');
const { readdirSync } = require('fs');
const fixtures = require('../common/fixtures');
const testFixtures = fixtures.path('test-runner');

{
  // File not found.
  const args = ['--test', 'a-random-file-that-does-not-exist.js'];
  const child = spawnSync(process.execPath, args);

  assert.strictEqual(child.status, 1);
  assert.strictEqual(child.signal, null);
  assert.strictEqual(child.stdout.toString(), '');
  assert.match(child.stderr.toString(), /^Could not find/);
}

{
  // Default behavior. node_modules is ignored. Files that don't match the
  // pattern are ignored except in test/ directories.
  const args = ['--test'];
  const child = spawnSync(process.execPath, args, { cwd: join(testFixtures, 'default-behavior') });

  assert.strictEqual(child.status, 1);
  assert.strictEqual(child.signal, null);
  assert.strictEqual(child.stderr.toString(), '');
  const stdout = child.stdout.toString();
  assert.match(stdout, /ok 1 - this should pass/);
  assert.match(stdout, /not ok 2 - this should fail/);
  assert.match(stdout, /ok 3 - .+subdir.+subdir_test\.js/);
  assert.match(stdout, /ok 4 - this should pass/);
  assert.match(stdout, /ok 5 - this should be skipped/);
  assert.match(stdout, /ok 6 - this should be executed/);
}

{
  // Same but with a prototype mutation in require scripts.
  const args = ['--require', join(testFixtures, 'protoMutation.js'), '--test'];
  const child = spawnSync(process.execPath, args, { cwd: join(testFixtures, 'default-behavior') });

  const stdout = child.stdout.toString();
  assert.match(stdout, /ok 1 - this should pass/);
  assert.match(stdout, /not ok 2 - this should fail/);
  assert.match(stdout, /ok 3 - .+subdir.+subdir_test\.js/);
  assert.match(stdout, /ok 4 - this should pass/);
  assert.match(stdout, /ok 5 - this should be skipped/);
  assert.match(stdout, /ok 6 - this should be executed/);
  assert.strictEqual(child.status, 1);
  assert.strictEqual(child.signal, null);
  assert.strictEqual(child.stderr.toString(), '');
}

{
  // User specified files that don't match the pattern are still run.
  const args = ['--test', join(testFixtures, 'index.js')];
  const child = spawnSync(process.execPath, args, { cwd: testFixtures });

  assert.strictEqual(child.status, 1);
  assert.strictEqual(child.signal, null);
  assert.strictEqual(child.stderr.toString(), '');
  const stdout = child.stdout.toString();
  assert.match(stdout, /not ok 1 - .+index\.js/);
}

{
  // Searches node_modules if specified.
  const args = ['--test', join(testFixtures, 'default-behavior/node_modules')];
  const child = spawnSync(process.execPath, args);

  assert.strictEqual(child.status, 1);
  assert.strictEqual(child.signal, null);
  assert.strictEqual(child.stderr.toString(), '');
  const stdout = child.stdout.toString();
  assert.match(stdout, /not ok 1 - .+test-nm\.js/);
}

{
  // The current directory is used by default.
  const args = ['--test'];
  const options = { cwd: join(testFixtures, 'default-behavior') };
  const child = spawnSync(process.execPath, args, options);

  assert.strictEqual(child.status, 1);
  assert.strictEqual(child.signal, null);
  assert.strictEqual(child.stderr.toString(), '');
  const stdout = child.stdout.toString();
  assert.match(stdout, /ok 1 - this should pass/);
  assert.match(stdout, /not ok 2 - this should fail/);
  assert.match(stdout, /ok 3 - .+subdir.+subdir_test\.js/);
  assert.match(stdout, /ok 4 - this should pass/);
  assert.match(stdout, /ok 5 - this should be skipped/);
  assert.match(stdout, /ok 6 - this should be executed/);
}

{
  // Flags that cannot be combined with --test.
  const flags = [
    ['--check', '--test'],
    ['--interactive', '--test'],
    ['--eval', 'console.log("should not print")', '--test'],
    ['--print', 'console.log("should not print")', '--test'],
  ];

  for (const args of flags) {
    const child = spawnSync(process.execPath, args);

    assert.notStrictEqual(child.status, 0);
    assert.strictEqual(child.signal, null);
    assert.strictEqual(child.stdout.toString(), '');
    const stderr = child.stderr.toString();
    assert.match(stderr, /--test/);
  }
}

{
  // Test combined stream outputs
  const args = [
    '--test',
    'test/fixtures/test-runner/default-behavior/index.test.js',
    'test/fixtures/test-runner/nested.js',
    'test/fixtures/test-runner/invalid-tap.js',
  ];
  const child = spawnSync(process.execPath, args);


  assert.strictEqual(child.status, 1);
  assert.strictEqual(child.signal, null);
  assert.strictEqual(child.stderr.toString(), '');
  const stdout = child.stdout.toString();
  assert.match(stdout, /# Subtest: this should pass/);
  assert.match(stdout, /ok 1 - this should pass/);
  assert.match(stdout, / {2}---/);
  assert.match(stdout, / {2}duration_ms: .*/);
  assert.match(stdout, / {2}\.\.\./);

  assert.match(stdout, /# Subtest: .+invalid-tap\.js/);
  assert.match(stdout, /# invalid tap output/);
  assert.match(stdout, /ok 2 - .+invalid-tap\.js/);

  assert.match(stdout, /# Subtest: level 0a/);
  assert.match(stdout, / {4}# Subtest: level 1a/);
  assert.match(stdout, / {4}ok 1 - level 1a/);
  assert.match(stdout, / {4}# Subtest: level 1b/);
  assert.match(stdout, / {4}not ok 2 - level 1b/);
  assert.match(stdout, / {6}code: 'ERR_TEST_FAILURE'/);
  assert.match(stdout, / {6}stack: |-'/);
  assert.match(stdout, / {8}TestContext\.<anonymous> .*/);
  assert.match(stdout, / {4}# Subtest: level 1c/);
  assert.match(stdout, / {4}ok 3 - level 1c # SKIP aaa/);
  assert.match(stdout, / {4}# Subtest: level 1d/);
  assert.match(stdout, / {4}ok 4 - level 1d/);
  assert.match(stdout, /not ok 3 - level 0a/);
  assert.match(stdout, / {2}error: '1 subtest failed'/);
  assert.match(stdout, /# Subtest: level 0b/);
  assert.match(stdout, /not ok 4 - level 0b/);
  assert.match(stdout, / {2}error: 'level 0b error'/);
  assert.match(stdout, /# tests 8/);
  assert.match(stdout, /# suites 0/);
  assert.match(stdout, /# pass 4/);
  assert.match(stdout, /# fail 3/);
  assert.match(stdout, /# cancelled 0/);
  assert.match(stdout, /# skipped 1/);
  assert.match(stdout, /# todo 0/);
}

{
  // Test user logging in tests.
  const args = [
    '--test',
    'test/fixtures/test-runner/user-logs.js',
  ];
  const child = spawnSync(process.execPath, args);

  assert.strictEqual(child.status, 0);
  assert.strictEqual(child.signal, null);
  assert.strictEqual(child.stderr.toString(), '');
  const stdout = child.stdout.toString();
  assert.match(stdout, /# stderr 1/);
  assert.match(stdout, /# stderr 2/);
  assert.match(stdout, /# stdout 3/);
  assert.match(stdout, /# stderr 6/);
  assert.match(stdout, /# not ok 1 - fake test/);
  assert.match(stdout, /# stderr 5/);
  assert.match(stdout, /# stdout 4/);
  assert.match(stdout, /# Subtest: a test/);
  assert.match(stdout, /ok 1 - a test/);
  assert.match(stdout, /# tests 1/);
  assert.match(stdout, /# pass 1/);
}

{
  // Use test with --loader and --require.
  // This case is common since vscode uses --require to load the debugger.
  const args = ['--no-warnings',
                '--experimental-loader', 'data:text/javascript,',
                '--require', fixtures.path('empty.js'),
                '--test', join(testFixtures, 'default-behavior', 'index.test.js')];
  const child = spawnSync(process.execPath, args);

  assert.strictEqual(child.stderr.toString(), '');
  assert.strictEqual(child.status, 0);
  assert.strictEqual(child.signal, null);
  const stdout = child.stdout.toString();
  assert.match(stdout, /ok 1 - this should pass/);
}

{
  // --test-shard option validation
  const args = ['--test', '--test-shard=1', join(testFixtures, 'index.js')];
  const child = spawnSync(process.execPath, args, { cwd: testFixtures });

  assert.strictEqual(child.status, 1);
  assert.strictEqual(child.signal, null);
  assert.match(child.stderr.toString(), /The argument '--test-shard' must be in the form of <index>\/<total>\. Received '1'/);
  const stdout = child.stdout.toString();
  assert.strictEqual(stdout, '');
}

{
  // --test-shard option validation
  const args = ['--test', '--test-shard=1/2/3', join(testFixtures, 'index.js')];
  const child = spawnSync(process.execPath, args, { cwd: testFixtures });

  assert.strictEqual(child.status, 1);
  assert.strictEqual(child.signal, null);
  assert.match(child.stderr.toString(), /The argument '--test-shard' must be in the form of <index>\/<total>\. Received '1\/2\/3'/);
  const stdout = child.stdout.toString();
  assert.strictEqual(stdout, '');
}

{
  // --test-shard option validation
  const args = ['--test', '--test-shard=0/3', join(testFixtures, 'index.js')];
  const child = spawnSync(process.execPath, args, { cwd: testFixtures });

  assert.strictEqual(child.status, 1);
  assert.strictEqual(child.signal, null);
  assert.match(child.stderr.toString(), /The value of "options\.shard\.index" is out of range\. It must be >= 1 && <= 3\. Received 0/);
  const stdout = child.stdout.toString();
  assert.strictEqual(stdout, '');
}

{
  // --test-shard option validation
  const args = ['--test', '--test-shard=0xf/20abcd', join(testFixtures, 'index.js')];
  const child = spawnSync(process.execPath, args, { cwd: testFixtures });

  assert.strictEqual(child.status, 1);
  assert.strictEqual(child.signal, null);
  assert.match(child.stderr.toString(), /The argument '--test-shard' must be in the form of <index>\/<total>\. Received '0xf\/20abcd'/);
  const stdout = child.stdout.toString();
  assert.strictEqual(stdout, '');
}

{
  // --test-shard option validation
  const args = ['--test', '--test-shard=hello', join(testFixtures, 'index.js')];
  const child = spawnSync(process.execPath, args, { cwd: testFixtures });

  assert.strictEqual(child.status, 1);
  assert.strictEqual(child.signal, null);
  assert.match(child.stderr.toString(), /The argument '--test-shard' must be in the form of <index>\/<total>\. Received 'hello'/);
  const stdout = child.stdout.toString();
  assert.strictEqual(stdout, '');
}

{
  // --test-shard option, first shard
  const shardsTestPath = join(testFixtures, 'shards');
  const allShardsTestsFiles = readdirSync(shardsTestPath).map((file) => join(shardsTestPath, file));
  const args = [
    '--test',
    '--test-shard=1/2',
    ...allShardsTestsFiles,
  ];
  const child = spawnSync(process.execPath, args);

  assert.strictEqual(child.status, 0);
  assert.strictEqual(child.signal, null);
  assert.strictEqual(child.stderr.toString(), '');
  const stdout = child.stdout.toString();
  assert.match(stdout, /# Subtest: a\.cjs this should pass/);
  assert.match(stdout, /ok 1 - a\.cjs this should pass/);

  assert.match(stdout, /# Subtest: c\.cjs this should pass/);
  assert.match(stdout, /ok 2 - c\.cjs this should pass/);

  assert.match(stdout, /# Subtest: e\.cjs this should pass/);
  assert.match(stdout, /ok 3 - e\.cjs this should pass/);

  assert.match(stdout, /# Subtest: g\.cjs this should pass/);
  assert.match(stdout, /ok 4 - g\.cjs this should pass/);

  assert.match(stdout, /# Subtest: i\.cjs this should pass/);
  assert.match(stdout, /ok 5 - i\.cjs this should pass/);

  assert.match(stdout, /# tests 5/);
  assert.match(stdout, /# pass 5/);
  assert.match(stdout, /# fail 0/);
  assert.match(stdout, /# skipped 0/);
}

{
  // --test-shard option, last shard
  const shardsTestPath = join(testFixtures, 'shards');
  const allShardsTestsFiles = readdirSync(shardsTestPath).map((file) => join(shardsTestPath, file));
  const args = [
    '--test',
    '--test-shard=2/2',
    ...allShardsTestsFiles,
  ];
  const child = spawnSync(process.execPath, args);

  assert.strictEqual(child.status, 0);
  assert.strictEqual(child.signal, null);
  assert.strictEqual(child.stderr.toString(), '');
  const stdout = child.stdout.toString();
  assert.match(stdout, /# Subtest: b\.cjs this should pass/);
  assert.match(stdout, /ok 1 - b\.cjs this should pass/);

  assert.match(stdout, /# Subtest: d\.cjs this should pass/);
  assert.match(stdout, /ok 2 - d\.cjs this should pass/);

  assert.match(stdout, /# Subtest: f\.cjs this should pass/);
  assert.match(stdout, /ok 3 - f\.cjs this should pass/);

  assert.match(stdout, /# Subtest: h\.cjs this should pass/);
  assert.match(stdout, /ok 4 - h\.cjs this should pass/);

  assert.match(stdout, /# Subtest: j\.cjs this should pass/);
  assert.match(stdout, /ok 5 - j\.cjs this should pass/);

  assert.match(stdout, /# tests 5/);
  assert.match(stdout, /# pass 5/);
  assert.match(stdout, /# fail 0/);
  assert.match(stdout, /# skipped 0/);
}
