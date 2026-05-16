/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, describe, it } from 'vitest';
import { escapeRegex, buildArgsPatterns, isSafeRegExp } from './utils.js';

describe('policy/utils', () => {
  describe('escapeRegex', () => {
    it('should escape special regex characters', () => {
      const input = '.-*+?^${}()|[]\\ "';
      const escaped = escapeRegex(input);
      expect(escaped).toBe(
        '\\.\\-\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\\\ \\"',
      );
    });

    it('should return the same string if no special characters are present', () => {
      const input = 'abcABC123';
      expect(escapeRegex(input)).toBe(input);
    });
  });

  describe('isSafeRegExp', () => {
    it('should return true for simple regexes', () => {
      expect(isSafeRegExp('abc')).toBe(true);
      expect(isSafeRegExp('^abc$')).toBe(true);
      expect(isSafeRegExp('a|b')).toBe(true);
    });

    it('should return true for safe quantifiers', () => {
      expect(isSafeRegExp('a+')).toBe(true);
      expect(isSafeRegExp('a*')).toBe(true);
      expect(isSafeRegExp('a?')).toBe(true);
      expect(isSafeRegExp('a{1,3}')).toBe(true);
    });

    it('should return true for safe groups', () => {
      expect(isSafeRegExp('(abc)*')).toBe(true);
      expect(isSafeRegExp('(a|b)+')).toBe(true);
    });

    it('should return false for invalid regexes', () => {
      expect(isSafeRegExp('[')).toBe(false);
      expect(isSafeRegExp('([a-z)')).toBe(false);
      expect(isSafeRegExp('*')).toBe(false);
    });

    it('should return false for long regexes', () => {
      expect(isSafeRegExp('a'.repeat(3000))).toBe(false);
    });

    it('should return false for nested quantifiers (ReDoS heuristic)', () => {
      expect(isSafeRegExp('(a+)+')).toBe(false);
      expect(isSafeRegExp('(a|b)*')).toBe(true);
      expect(isSafeRegExp('(.*)*')).toBe(false);
      expect(isSafeRegExp('([a-z]+)+')).toBe(false);
      expect(isSafeRegExp('(.*)+')).toBe(false);
    });
  });

  describe('buildArgsPatterns', () => {
    it('should return argsPattern if provided and no commandPrefix/regex', () => {
      const result = buildArgsPatterns('my-pattern', undefined, undefined);
      expect(result).toEqual(['my-pattern']);
    });

    it('should build pattern from a single commandPrefix', () => {
      const result = buildArgsPatterns(undefined, 'ls', undefined);
      expect(result).toEqual(['\\"command\\":\\"ls(?:[\\s"]|\\\\")']);
    });

    it('should build patterns from an array of commandPrefixes', () => {
      const result = buildArgsPatterns(undefined, ['echo', 'ls'], undefined);
      expect(result).toEqual([
        '\\"command\\":\\"echo(?:[\\s"]|\\\\")',
        '\\"command\\":\\"ls(?:[\\s"]|\\\\")',
      ]);
    });

    it('should build pattern from commandRegex', () => {
      const result = buildArgsPatterns(undefined, undefined, 'rm -rf .*');
      expect(result).toEqual(['"command":"rm -rf .*']);
    });

    it('should strip leading ^ from commandRegex to anchor to command value start', () => {
      // A leading '^' is broken in the raw JSON context because `"command":"` is
      // prepended, making it impossible to match. Stripping '^' is semantically
      // equivalent: the prefix already anchors to the start of the command value.
      const result = buildArgsPatterns(undefined, undefined, '^git status');
      expect(result).toEqual(['"command":"git status']);
      const regex = new RegExp(result[0]!);
      // Should match commands that start with "git status"
      expect(regex.test('{"command":"git status"}')).toBe(true);
      expect(regex.test('{"command":"git status --all"}')).toBe(true);
      // Should NOT match commands that contain "git status" elsewhere
      expect(regex.test('{"command":"not git status"}')).toBe(false);
    });

    it('should replace trailing $ in commandRegex to anchor to end of command value', () => {
      // A trailing '$' would match end-of-JSON-string (after '}'), not end of
      // the command value. Replace it with (?=") to anchor to the closing quote.
      const result = buildArgsPatterns(undefined, undefined, 'git status$');
      expect(result).toEqual(['"command":"git status(?=")']);
      const regex = new RegExp(result[0]!);
      expect(regex.test('{"command":"git status"}')).toBe(true);
      // Should NOT match when extra args are appended
      expect(regex.test('{"command":"git status --all"}')).toBe(false);
    });

    it('should handle commandRegex with both ^ and $ anchors', () => {
      const result = buildArgsPatterns(undefined, undefined, '^git status$');
      expect(result).toEqual(['"command":"git status(?=")']);
      const regex = new RegExp(result[0]!);
      // Exact match only
      expect(regex.test('{"command":"git status"}')).toBe(true);
      expect(regex.test('{"command":"git status --all"}')).toBe(false);
      expect(regex.test('{"command":"not git status"}')).toBe(false);
    });

    it('should preserve escaped \\$ (literal dollar sign) in commandRegex', () => {
      // \$ means a literal '$' in the command, not an anchor.
      const result = buildArgsPatterns(undefined, undefined, 'echo \\$HOME');
      expect(result).toEqual(['"command":"echo \\$HOME']);
    });

    it('should prioritize commandPrefix over commandRegex and argsPattern', () => {
      const result = buildArgsPatterns('raw', 'prefix', 'regex');
      expect(result).toEqual(['\\"command\\":\\"prefix(?:[\\s"]|\\\\")']);
    });

    it('should prioritize commandRegex over argsPattern if no commandPrefix', () => {
      const result = buildArgsPatterns('raw', undefined, 'regex');
      expect(result).toEqual(['"command":"regex']);
    });

    it('should escape characters in commandPrefix', () => {
      const result = buildArgsPatterns(undefined, 'git checkout -b', undefined);
      expect(result).toEqual([
        '\\"command\\":\\"git\\ checkout\\ \\-b(?:[\\s"]|\\\\")',
      ]);
    });

    it('should correctly escape quotes in commandPrefix', () => {
      const result = buildArgsPatterns(undefined, 'git "fix"', undefined);
      expect(result).toEqual([
        // eslint-disable-next-line no-useless-escape
        '\\\"command\\\":\\\"git\\ \\\\\\\"fix\\\\\\\"(?:[\\s\"]|\\\\\")',
      ]);
    });

    it('should handle undefined correctly when no inputs are provided', () => {
      const result = buildArgsPatterns(undefined, undefined, undefined);
      expect(result).toEqual([undefined]);
    });

    it('should match prefixes followed by JSON escaped quotes', () => {
      // Testing the security fix logic: allowing "echo \"foo\""
      const prefix = 'echo ';
      const patterns = buildArgsPatterns(undefined, prefix, undefined);
      const regex = new RegExp(patterns[0]!);

      // Mimic JSON stringified args
      // echo "foo" -> {"command":"echo \"foo\""}
      const validJsonArgs = '{"command":"echo \\"foo\\""}';
      expect(regex.test(validJsonArgs)).toBe(true);
    });

    it('should NOT match prefixes followed by raw backslashes (security check)', () => {
      // Testing that we blocked the hole: "echo\foo"
      const prefix = 'echo ';
      const patterns = buildArgsPatterns(undefined, prefix, undefined);
      const regex = new RegExp(patterns[0]!);

      // echo\foo -> {"command":"echo\\foo"}
      // In regex matching: "echo " is followed by "\" which is NOT in [\s"] and is not \"
      const attackJsonArgs = '{"command":"echo\\\\foo"}';
      expect(regex.test(attackJsonArgs)).toBe(false);

      // Also validation for "git " matching "git\status"
      const gitPatterns = buildArgsPatterns(undefined, 'git ', undefined);
      const gitRegex = new RegExp(gitPatterns[0]!);
      // git\status -> {"command":"git\\status"}
      const gitAttack = '{"command":"git\\\\status"}';
      expect(gitAttack).not.toMatch(gitRegex);
    });
  });
});
