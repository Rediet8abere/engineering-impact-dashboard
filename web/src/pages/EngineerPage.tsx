import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useImpact, useSubsystems, useTimeline } from "../api/hooks";

type DailyPoint = { day: string; merges: number; weighted_merges: number; reviews_submitted: number };
type WeeklyPoint = { week: string; merges: number; weightedMerges: number; reviewsSubmitted: number };

export function EngineerPage() {
  const { engineerId } = useParams();
  const [tab, setTab] = useState<"overview" | "trends" | "subsystems">("overview");
  const [granularity, setGranularity] = useState<"daily" | "weekly">("daily");

  const impact = useImpact(engineerId);
  const timeline = useTimeline(engineerId, granularity, tab === "trends");
  const subs = useSubsystems(engineerId, tab === "subsystems");

  const chartData = useMemo(() => {
    if (!timeline.data) return [];
    if (timeline.data.granularity === "daily") {
      return (timeline.data.series as DailyPoint[]).map((p) => ({
        x: p.day.slice(5),
        merges: p.merges,
        weighted: p.weighted_merges,
      }));
    }
    return (timeline.data.series as WeeklyPoint[]).map((p) => ({
      x: p.week,
      merges: p.merges,
      weighted: p.weightedMerges,
    }));
  }, [timeline.data]);

  if (!engineerId) return <div className="panel error">Missing engineer id</div>;
  if (impact.isLoading) return <div className="panel">Loading…</div>;
  if (impact.isError) {
    return (
      <div className="panel error">
        Failed to load engineer. <span className="mono">{String(impact.error)}</span>
      </div>
    );
  }

  const d = impact.data;

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <Link to="/" className="btn">
          ← Leaderboard
        </Link>
        <span className="pill">
          Window <span className="mono">{d.snapshot.window_end}</span>
        </span>
      </div>

      <div className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{d.engineer.display_name}</div>
            <div className="mono">{d.engineer.github_login}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Impact score
            </div>
            <div className="score" style={{ fontSize: 34, lineHeight: 1 }}>
              {d.impact_score.toFixed(1)}
            </div>
          </div>
        </div>

        <div style={{ height: 14 }} />

        <div className="grid2">
          <div className="panel" style={{ padding: 12 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Pillar breakdown
            </div>
            <div style={{ height: 10 }} />
            <Pillar label="Throughput" value={d.subscores.throughput} w={0.3} />
            <Pillar label="Consistency" value={d.subscores.consistency} w={0.2} />
            <Pillar label="Review quality" value={d.subscores.review_quality} w={0.2} />
            <Pillar label="Stability" value={d.subscores.stability} w={0.2} />
            <Pillar label="Subsystem complexity" value={d.subscores.subsystem_complexity} w={0.1} />
          </div>
          <div className="panel" style={{ padding: 12 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              90d metrics (materialized)
            </div>
            <div style={{ height: 10 }} />
            <Metric k="Merges" v={String(d.metrics.merges_90d)} />
            <Metric k="Weighted merges" v={d.metrics.weighted_merges_90d.toFixed(2)} />
            <Metric k="Median cycle (h)" v={d.metrics.median_cycle_hours?.toFixed(1) ?? "n/a"} />
            <Metric k="Active days" v={String(d.metrics.active_days)} />
            <Metric k="Active weeks" v={String(d.metrics.active_weeks)} />
          </div>
        </div>

        <div style={{ height: 14 }} />

        <div className="tabs">
          <button
            type="button"
            className={`tab ${tab === "overview" ? "tabActive" : ""}`}
            onClick={() => setTab("overview")}
          >
            Explain JSON
          </button>
          <button
            type="button"
            className={`tab ${tab === "trends" ? "tabActive" : ""}`}
            onClick={() => setTab("trends")}
          >
            Trends
          </button>
          <button
            type="button"
            className={`tab ${tab === "subsystems" ? "tabActive" : ""}`}
            onClick={() => setTab("subsystems")}
          >
            Subsystems
          </button>
        </div>

        {tab === "overview" ? (
          <pre className="mono" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
            {JSON.stringify(d.explain, null, 2)}
          </pre>
        ) : null}

        {tab === "trends" ? (
          <div>
            <div className="row">
              <button
                type="button"
                className={`btn ${granularity === "daily" ? "btnPrimary" : ""}`}
                onClick={() => setGranularity("daily")}
              >
                Daily
              </button>
              <button
                type="button"
                className={`btn ${granularity === "weekly" ? "btnPrimary" : ""}`}
                onClick={() => setGranularity("weekly")}
              >
                Weekly
              </button>
            </div>
            <div style={{ height: 12 }} />
            {timeline.isLoading ? (
              <div className="muted">Loading chart…</div>
            ) : timeline.isError ? (
              <div className="error">Failed to load timeline</div>
            ) : (
              <div style={{ width: "100%", height: 320 }}>
                <ResponsiveContainer>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(154,164,214,0.18)" />
                    <XAxis dataKey="x" stroke="rgba(154,164,214,0.85)" />
                    <YAxis stroke="rgba(154,164,214,0.85)" />
                    <Tooltip
                      contentStyle={{ background: "#0f1733", border: "1px solid #243055" }}
                      labelStyle={{ color: "#e8ecff" }}
                    />
                    <Line type="monotone" dataKey="merges" stroke="#3dd68c" dot={false} strokeWidth={2} />
                    <Line type="monotone" dataKey="weighted" stroke="#7c5cff" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
              Green: merges/day (or week). Purple: weighted merges/day (or week).
            </div>
          </div>
        ) : null}

        {tab === "subsystems" ? (
          <div>
            {subs.isLoading ? (
              <div className="muted">Loading subsystem breakdown…</div>
            ) : subs.isError ? (
              <div className="error">Failed to load subsystems</div>
            ) : (
              <div style={{ width: "100%", height: 360 }}>
                <ResponsiveContainer>
                  <BarChart data={subs.data.items} layout="vertical" margin={{ left: 90 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(154,164,214,0.18)" />
                    <XAxis type="number" stroke="rgba(154,164,214,0.85)" />
                    <YAxis type="category" dataKey="slug" stroke="rgba(154,164,214,0.85)" width={86} />
                    <Tooltip
                      contentStyle={{ background: "#0f1733", border: "1px solid #243055" }}
                      labelStyle={{ color: "#e8ecff" }}
                    />
                    <Bar dataKey="weightedMerges" fill="#7c5cff" radius={[0, 8, 8, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Pillar(props: { label: string; value: number; w: number }) {
  const contrib = props.value * props.w;
  return (
    <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
      <div className="muted">
        {props.label} <span className="mono">×{props.w}</span>
      </div>
      <div style={{ textAlign: "right" }}>
        <span style={{ fontWeight: 700 }}>{props.value.toFixed(1)}</span>{" "}
        <span className="muted mono">→ {contrib.toFixed(1)}</span>
      </div>
    </div>
  );
}

function Metric(props: { k: string; v: string }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
      <div className="muted">{props.k}</div>
      <div className="mono">{props.v}</div>
    </div>
  );
}
