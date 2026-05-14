import { useQuery } from "@tanstack/react-query";
import { api } from "./client";

export function useSnapshot() {
  return useQuery({
    queryKey: ["snapshot", "current"],
    queryFn: () => api.snapshot(),
  });
}

export function useLeaderboard(limit = 5) {
  return useQuery({
    queryKey: ["leaderboard", "90d", limit],
    queryFn: () => api.leaderboard(limit),
  });
}

export function useImpact(engineerId: string | undefined) {
  return useQuery({
    queryKey: ["impact", engineerId],
    queryFn: () => api.impact(engineerId!),
    enabled: Boolean(engineerId),
  });
}

export function useTimeline(
  engineerId: string | undefined,
  granularity: "daily" | "weekly",
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["timeline", engineerId, granularity],
    queryFn: () => api.timeline(engineerId!, granularity),
    enabled: Boolean(engineerId) && enabled,
  });
}

export function useSubsystems(engineerId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["subsystems", engineerId],
    queryFn: () => api.subsystems(engineerId!),
    enabled: Boolean(engineerId) && enabled,
  });
}
