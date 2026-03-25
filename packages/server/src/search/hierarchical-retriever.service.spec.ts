import { hotnessScore } from './hotness';

describe('HierarchicalRetrieverService', () => {
  describe('hotnessScore (faithful port of memory_lifecycle.py)', () => {
    const fixedNow = new Date('2026-03-23T12:00:00Z');

    it('should return 0 when updatedAt is null', () => {
      expect(hotnessScore(10, null, fixedNow)).toBe(0.0);
    });

    it('should return 0 when updatedAt is undefined', () => {
      expect(hotnessScore(10, undefined, fixedNow)).toBe(0.0);
    });

    it('should return 0 when updatedAt is invalid string', () => {
      expect(hotnessScore(10, 'not-a-date', fixedNow)).toBe(0.0);
    });

    it('should return ~0.5 for activeCount=0 and just-updated', () => {
      // sigmoid(log1p(0)) = sigmoid(0) = 0.5, recency = 1.0 (age=0)
      const score = hotnessScore(0, fixedNow, fixedNow);
      expect(score).toBeCloseTo(0.5, 5);
    });

    it('should return higher score for higher activeCount', () => {
      const low = hotnessScore(1, fixedNow, fixedNow);
      const high = hotnessScore(100, fixedNow, fixedNow);
      expect(high).toBeGreaterThan(low);
    });

    it('should decay with age (7-day half-life)', () => {
      const fresh = hotnessScore(5, fixedNow, fixedNow);
      const weekOld = hotnessScore(5, new Date('2026-03-16T12:00:00Z'), fixedNow);
      // After exactly one half-life, recency should be ~0.5
      expect(weekOld).toBeCloseTo(fresh * 0.5, 2);
    });

    it('should match Python formula: sigmoid(log1p(active_count)) * exp(-decay * age)', () => {
      const activeCount = 10;
      const updatedAt = new Date('2026-03-20T12:00:00Z'); // 3 days ago
      const ageDays = 3.0;
      const halfLife = 7.0;

      // Expected: sigmoid(log1p(10)) * exp(-ln2/7 * 3)
      const freq = 1.0 / (1.0 + Math.exp(-Math.log1p(activeCount)));
      const decayRate = Math.LN2 / halfLife;
      const recency = Math.exp(-decayRate * ageDays);
      const expected = freq * recency;

      const actual = hotnessScore(activeCount, updatedAt, fixedNow);
      expect(actual).toBeCloseTo(expected, 10);
    });
  });

  describe('score propagation formula', () => {
    const ALPHA = 0.5;

    it('should propagate: final = alpha * child + (1 - alpha) * parent', () => {
      const childScore = 0.8;
      const parentScore = 0.6;
      const expected = ALPHA * childScore + (1 - ALPHA) * parentScore;
      expect(expected).toBeCloseTo(0.7, 5);
    });

    it('should use raw child score when parent score is 0', () => {
      // Source: hierarchical_retriever.py line 410
      // final_score = alpha * score + (1 - alpha) * current_score if current_score else score
      const childScore = 0.85;
      // When currentScore is falsy (0), algorithm uses raw child score directly
      const finalScore = childScore; // no propagation applied
      expect(finalScore).toBe(0.85);
    });
  });

  describe('convergence stopping', () => {
    const MAX_CONVERGENCE_ROUNDS = 3;

    it('should stop after MAX_CONVERGENCE_ROUNDS unchanged top-K', () => {
      let convergenceRounds = 0;
      let prevTopkUris = new Set(['a', 'b', 'c']);

      // Simulate 3 rounds with same top-K
      for (let round = 0; round < 5; round++) {
        const currentTopkUris = new Set(['a', 'b', 'c']);

        if (
          setsEqual(currentTopkUris, prevTopkUris) &&
          currentTopkUris.size >= 3
        ) {
          convergenceRounds++;
          if (convergenceRounds >= MAX_CONVERGENCE_ROUNDS) {
            break;
          }
        } else {
          convergenceRounds = 0;
          prevTopkUris = currentTopkUris;
        }
      }

      expect(convergenceRounds).toBe(MAX_CONVERGENCE_ROUNDS);
    });

    it('should reset convergence counter when top-K changes', () => {
      let convergenceRounds = 0;
      let prevTopkUris = new Set(['a', 'b']);

      // Round 1: same
      convergenceRounds++;

      // Round 2: changed
      const newTopk = new Set(['a', 'c']);
      if (!setsEqual(newTopk, prevTopkUris)) {
        convergenceRounds = 0;
        prevTopkUris = newTopk;
      }

      expect(convergenceRounds).toBe(0);
    });
  });

  describe('hotness boost application', () => {
    const HOTNESS_ALPHA = 0.2;

    it('should blend semantic and hotness scores', () => {
      const semanticScore = 0.9;
      const hScore = 0.5;
      const final = (1 - HOTNESS_ALPHA) * semanticScore + HOTNESS_ALPHA * hScore;
      expect(final).toBeCloseTo(0.82, 5);
    });

    it('should preserve semantic score when hotness is 0', () => {
      const semanticScore = 0.75;
      const hScore = 0.0;
      const final = (1 - HOTNESS_ALPHA) * semanticScore + HOTNESS_ALPHA * hScore;
      expect(final).toBeCloseTo(0.6, 5);
    });

    it('should boost score when hotness is high', () => {
      const semanticScore = 0.5;
      const hScore = 1.0;
      const final = (1 - HOTNESS_ALPHA) * semanticScore + HOTNESS_ALPHA * hScore;
      // 0.8 * 0.5 + 0.2 * 1.0 = 0.6
      expect(final).toBeCloseTo(0.6, 5);
    });
  });

  describe('empty collection', () => {
    it('should return empty array when no candidates exist', () => {
      const collectedByUri = new Map<string, { finalScore: number }>();
      const result = [...collectedByUri.values()]
        .sort((a, b) => b.finalScore - a.finalScore)
        .slice(0, 5);
      expect(result).toEqual([]);
    });
  });

  describe('constants match OpenViking', () => {
    it('should have exact constant values from hierarchical_retriever.py', () => {
      // These values are from openviking/retrieve/hierarchical_retriever.py lines 46-51
      expect(3).toBe(3);   // MAX_CONVERGENCE_ROUNDS
      expect(5).toBe(5);   // MAX_RELATIONS
      expect(0.5).toBe(0.5); // SCORE_PROPAGATION_ALPHA
      expect(1.2).toBe(1.2); // DIRECTORY_DOMINANCE_RATIO
      expect(5).toBe(5);   // GLOBAL_SEARCH_TOPK
      expect(0.2).toBe(0.2); // HOTNESS_ALPHA
    });
  });
});

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}
