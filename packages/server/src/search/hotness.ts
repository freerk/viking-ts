/**
 * Hotness scoring for cold/hot memory lifecycle management.
 *
 * Faithful port of openviking/retrieve/memory_lifecycle.py.
 * Provides a pure function to compute a 0.0-1.0 hotness score based on
 * access frequency (active_count) and recency (updated_at).
 *
 * Formula:
 *   score = sigmoid(log1p(active_count)) * time_decay(updated_at)
 *
 * - sigmoid maps log1p(active_count) into (0, 1)
 * - time_decay is exponential decay with configurable half-life;
 *   returns 0.0 when updated_at is null/undefined
 */

/** Default half-life in days for the exponential time-decay component. */
const DEFAULT_HALF_LIFE_DAYS = 7.0;

/**
 * Compute a 0.0-1.0 hotness score.
 *
 * @param activeCount - Number of times this context was retrieved/accessed.
 * @param updatedAt - Last update/access timestamp (Date or ISO string). Null returns 0.
 * @param now - Current time override (useful for deterministic tests).
 * @param halfLifeDays - Half-life for the recency decay, in days.
 * @returns A float in [0.0, 1.0].
 *
 * Source: openviking/retrieve/memory_lifecycle.py
 */
export function hotnessScore(
  activeCount: number,
  updatedAt: Date | string | null | undefined,
  now?: Date,
  halfLifeDays: number = DEFAULT_HALF_LIFE_DAYS,
): number {
  const currentTime = now ?? new Date();

  // --- frequency component ---
  // sigmoid(log1p(active_count)) = 1 / (1 + exp(-log1p(active_count)))
  const freq = 1.0 / (1.0 + Math.exp(-Math.log1p(activeCount)));

  // --- recency component ---
  if (updatedAt === null || updatedAt === undefined) {
    return 0.0;
  }

  const updatedDate = typeof updatedAt === 'string' ? new Date(updatedAt) : updatedAt;

  if (isNaN(updatedDate.getTime())) {
    return 0.0;
  }

  const ageDays = Math.max(
    (currentTime.getTime() - updatedDate.getTime()) / (86400.0 * 1000),
    0.0,
  );
  const decayRate = Math.LN2 / halfLifeDays;
  const recency = Math.exp(-decayRate * ageDays);

  return freq * recency;
}
