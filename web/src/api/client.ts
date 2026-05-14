export type Snapshot = {
  window: "90d";
  window_end: string;
  as_of?: string | null;
};

export type LeaderboardRow = {
  rank: number;
  engineer_id: string;
  github_login: string;
  display_name: string;
  impact_score: number;
  merges_90d: number;
  weighted_merges_90d: number;
  subscores: Subscores;
};

export type Subscores = {
  throughput: number;
  consistency: number;
  review_quality: number;
  stability: number;
  subsystem_complexity: number;
};

export type LeaderboardResponse = {
  snapshot: Snapshot;
  rows: LeaderboardRow[];
};

export type ImpactResponse = {
  snapshot: Snapshot;
  engineer: { id: string; github_login: string; display_name: string };
  impact_score: number;
  subscores: Subscores;
  metrics: {
    merges_90d: number;
    weighted_merges_90d: number;
    median_cycle_hours: number | null;
    active_days: number;
    active_weeks: number;
  };
  explain: unknown;
};

export type TimelineResponse = {
  snapshot: Snapshot;
  granularity: "daily" | "weekly";
  series: unknown;
};

export type SubsystemsResponse = {
  snapshot: Snapshot;
  items: Array<{
    slug: string;
    merges: number;
    weightedMerges: number;
    share: number;
  }>;
};

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return (await res.json()) as T;
}

export const api = {
  snapshot: () => apiGet<Snapshot>("/api/snapshot/current"),
  leaderboard: (limit = 5) =>
    apiGet<LeaderboardResponse>(`/api/leaderboard?window=90d&limit=${limit}`),
  impact: (engineerId: string) =>
    apiGet<ImpactResponse>(`/api/engineers/${engineerId}/impact?window=90d`),
  timeline: (engineerId: string, granularity: "daily" | "weekly") =>
    apiGet<TimelineResponse>(
      `/api/engineers/${engineerId}/timeline?window=90d&granularity=${granularity}`,
    ),
  subsystems: (engineerId: string) =>
    apiGet<SubsystemsResponse>(`/api/engineers/${engineerId}/subsystems?window=90d`),
};
