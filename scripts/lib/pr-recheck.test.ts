import { describe, expect, it } from 'vitest';
import { filesIntersect, selectAffected, touchesGlobalPath } from './pr-recheck.mjs';

describe('touchesGlobalPath', () => {
  it('flags a shared contract file', () => {
    expect(touchesGlobalPath(['src/core/types.ts'])).toBe(true);
  });

  it('flags anything under test/fixtures', () => {
    expect(touchesGlobalPath(['test/fixtures/board.ts'])).toBe(true);
  });

  it('matches a file entry exactly, not by prefix', () => {
    expect(touchesGlobalPath(['src/core/types.test.ts'])).toBe(false);
  });

  it('does not flag stream-local files', () => {
    expect(touchesGlobalPath(['src/core/mask/blob.ts', 'src/render/board.ts'])).toBe(false);
  });
});

describe('filesIntersect', () => {
  it('is false for disjoint lanes', () => {
    expect(filesIntersect(['src/core/mask/blob.ts'], ['src/render/board.ts'])).toBe(false);
  });

  it('is true on a shared file', () => {
    expect(filesIntersect(['a.ts', 'b.ts'], ['b.ts'])).toBe(true);
  });
});

describe('selectAffected', () => {
  const prs = [
    { number: 1, files: ['src/core/mask/blob.ts'] },
    { number: 2, files: ['src/render/board.ts'] },
  ];

  it('re-checks every open PR when the merge changes a shared contract', () => {
    expect(selectAffected(['src/core/types.ts'], prs)).toEqual({
      affected: [1, 2],
      skipped: [],
      reason: 'global',
    });
  });

  it('re-checks only PRs whose own files the merge touched', () => {
    expect(selectAffected(['src/render/board.ts'], prs)).toEqual({
      affected: [2],
      skipped: [1],
      reason: 'overlap',
    });
  });

  it('re-checks nothing when the merge is disjoint from every open PR', () => {
    expect(selectAffected(['docs/PRD.md'], prs).affected).toEqual([]);
  });

  it('re-checks nothing when no PR is open', () => {
    expect(selectAffected(['src/core/types.ts'], []).affected).toEqual([]);
  });

  // #62. The two PRs shared no file at all — #53 changed only types.ts and #57
  // only src/core/validate/** — so exact overlap would have missed it and the
  // global-path rule is what catches it.
  it('would have re-checked #57 when #53 landed', () => {
    const open = [{ number: 57, files: ['src/core/validate/greedyClear.test.ts'] }];
    expect(selectAffected(['src/core/types.ts'], open).affected).toEqual([57]);
  });
});
