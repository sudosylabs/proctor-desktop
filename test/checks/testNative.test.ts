import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseNativeTestArguments,
  planNativeTestCommands,
  validateNativeTestSelection
} from '../../build/testNative.ts';

test('native test command accepts exact package and target selectors', () => {
  assert.deepEqual(
    parseNativeTestArguments([
      '--package', 'prctr-display-topology',
      '--target', 'x86_64-pc-windows-msvc'
    ]),
    {
      package: 'prctr-display-topology',
      target: 'x86_64-pc-windows-msvc',
      help: false
    }
  );
});

test('native test command rejects ambiguous or unsafe selectors', () => {
  assert.throws(() => parseNativeTestArguments(['prctr-display-topology']), /Unknown/);
  assert.throws(() => parseNativeTestArguments(['--package', '../outside']), /exact selector/);
  assert.throws(() => parseNativeTestArguments(['--target', 'windows']), /target triple/);
  assert.throws(
    () => parseNativeTestArguments(['--package', 'one', '--package', 'two']),
    /only once/
  );
});

test('native test command admits only workspace packages and built-in Rust targets', () => {
  const packages = new Set(['prctr-display-topology']);
  const targets = new Set(['x86_64-pc-windows-msvc']);
  assert.doesNotThrow(() => validateNativeTestSelection({
    package: 'prctr-display-topology',
    target: 'x86_64-pc-windows-msvc',
    help: false
  }, packages, targets));
  assert.throws(
    () => validateNativeTestSelection({ package: 'other', help: false }, packages, targets),
    /Unknown native workspace package/
  );
  assert.throws(
    () => validateNativeTestSelection({
      target: 'x86_64-custom-target.json',
      help: false
    }, packages, targets),
    /Unknown built-in Rust target/
  );
});

test('native test command keeps package and target scope on the promised phases', () => {
  assert.deepEqual(
    planNativeTestCommands({
      package: 'prctr-display-topology',
      target: 'x86_64-pc-windows-msvc',
      help: false
    }),
    [
      {
        phase: 'format',
        arguments: [
          'fmt', '--manifest-path', 'native/Cargo.toml',
          '--package', 'prctr-display-topology', '--', '--check'
        ]
      },
      {
        phase: 'lint',
        arguments: [
          'clippy', '--locked', '--manifest-path', 'native/Cargo.toml',
          '--package', 'prctr-display-topology', '--all-targets',
          '--target', 'x86_64-pc-windows-msvc', '--', '-D', 'warnings'
        ]
      },
      {
        phase: 'test',
        arguments: [
          'test', '--locked', '--manifest-path', 'native/Cargo.toml',
          '--package', 'prctr-display-topology',
          '--target', 'x86_64-pc-windows-msvc'
        ]
      }
    ]
  );
});

test('native test command scopes every phase to the workspace by default', () => {
  assert.deepEqual(
    planNativeTestCommands({ help: false }),
    [
      {
        phase: 'format',
        arguments: ['fmt', '--manifest-path', 'native/Cargo.toml', '--all', '--', '--check']
      },
      {
        phase: 'lint',
        arguments: [
          'clippy', '--locked', '--manifest-path', 'native/Cargo.toml',
          '--workspace', '--all-targets', '--', '-D', 'warnings'
        ]
      },
      {
        phase: 'test',
        arguments: [
          'test', '--locked', '--manifest-path', 'native/Cargo.toml', '--workspace'
        ]
      }
    ]
  );
});
