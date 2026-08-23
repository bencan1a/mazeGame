/**
 * The declared blocking edges (`edgeStart`/`edgeTarget`) must agree with what
 * actually walking each segment's exit ray finds, in both directions: nothing
 * declared that the ray does not hit, and nothing the ray hits that is not
 * declared.
 *
 */

import type { Board, SegmentId } from '../types.js';
import { BoardInvariantError } from '../types.js';
import { rayBlockers } from './rayBlockers.js';

export function checkEdgesMatchRays(board: Board): void {
  const n = board.segmentCount;
  for (let id = 1; id <= n; id++) {
    const from = board.edgeStart[id - 1] as number;
    const to = board.edgeStart[id] as number;
    const declared: SegmentId[] = [];
    for (let k = from; k < to; k++) declared.push(board.edgeTarget[k] as number);

    const badTarget = declared.find((target) => target < 1 || target > n || target === id);
    if (badTarget !== undefined) {
      throw new BoardInvariantError(
        badTarget === id
          ? `segment ${id} declares itself as its own blocker, but a segment's own cells never block it`
          : `segment ${id} declares a blocker ${badTarget}, which is not a valid segment id (1..${n})`,
        { segment: id, badTarget },
      );
    }
    const declaredSet = new Set(declared);
    if (declaredSet.size !== declared.length) {
      throw new BoardInvariantError(
        `segment ${id} declares a blocker more than once: [${declared.join(', ')}]`,
        { segment: id, declared },
      );
    }

    const derived = rayBlockers(board, id);
    const derivedSet = new Set(derived);

    const missing = derived.filter((target) => !declaredSet.has(target));
    const extra = declared.filter((target) => !derivedSet.has(target));
    if (missing.length > 0 || extra.length > 0) {
      throw new BoardInvariantError(
        `segment ${id}'s declared blockers [${declared.join(', ')}] disagree with its exit ray, ` +
          `which actually hits [${derived.join(', ')}]` +
          (missing.length > 0 ? `; missing: [${missing.join(', ')}]` : '') +
          (extra.length > 0 ? `; extra: [${extra.join(', ')}]` : ''),
        { segment: id, declared, derived, missing, extra },
      );
    }
  }
}
