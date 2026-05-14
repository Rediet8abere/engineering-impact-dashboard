export type Subscores = {
  throughput: number;
  consistency: number;
  review_quality: number;
  stability: number;
  subsystem_complexity: number;
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * impact_score =
 * 0.3 * throughput +
 * 0.2 * consistency +
 * 0.2 * review_quality +
 * 0.2 * stability +
 * 0.1 * subsystem_complexity
 *
 * All pillars are on a 0–100 scale.
 */
export function computeImpactScore(s: Subscores): number {
  const score =
    0.3 * s.throughput +
    0.2 * s.consistency +
    0.2 * s.review_quality +
    0.2 * s.stability +
    0.1 * s.subsystem_complexity;
  return Math.round(score * 10) / 10;
}

export function computeSubscores(input: {
  weightedMerges90d: number;
  maxWeightedMerges90d: number;
  medianCycleHours: number | null;
  activeDays: number;
  activeWeeks: number;
  avgReviewsPerMerge: number;
  churnRate: number;
  revertRate: number;
  hotfixRate: number;
  subsystemEntropy: number;
  avgSubsystemComplexity: number;
}): Subscores {
  const throughput = clamp(
    100 * (input.weightedMerges90d / input.maxWeightedMerges90d),
    0,
    100,
  );

  const consistencyBlend =
    0.55 * clamp((input.activeWeeks / 13) * 100, 0, 100) +
    0.45 * clamp((input.activeDays / 90) * 100, 0, 100);
  const consistency = clamp(consistencyBlend, 0, 100);

  const review_quality = clamp(18 * Math.log1p(input.avgReviewsPerMerge), 0, 100);

  const risk = input.churnRate + input.revertRate + input.hotfixRate;
  const stability = clamp(100 - 120 * g(risk), 0, 100);

  const complexityFromEntropy = clamp((input.subsystemEntropy / Math.log(6)) * 100, 0, 100);
  const complexityFromAvg = clamp(input.avgSubsystemComplexity, 0, 100);
  const subsystem_complexity = clamp(0.55 * complexityFromAvg + 0.45 * complexityFromEntropy, 0, 100);

  let cycleBonus = 55;
  if (input.medianCycleHours != null) {
    cycleBonus = clamp(100 - 6 * Math.log1p(input.medianCycleHours), 0, 100);
  }

  const throughput2 = clamp(0.75 * throughput + 0.25 * cycleBonus, 0, 100);

  return {
    throughput: Math.round(throughput2 * 10) / 10,
    consistency: Math.round(consistency * 10) / 10,
    review_quality: Math.round(review_quality * 10) / 10,
    stability: Math.round(stability * 10) / 10,
    subsystem_complexity: Math.round(subsystem_complexity * 10) / 10,
  };
}

function g(z: number): number {
  return z / (1 + z);
}
