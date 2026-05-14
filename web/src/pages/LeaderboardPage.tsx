import { Link } from "react-router-dom";
import { useLeaderboard, useSnapshot } from "../api/hooks";

export function LeaderboardPage() {
  const snap = useSnapshot();
  const lb = useLeaderboard(5);

  if (snap.isLoading || lb.isLoading) return <div className="panel">Loading…</div>;
  if (snap.isError || lb.isError) {
    return (
      <div className="panel error">
        Failed to load dashboard. Is the API running on port 4000?{" "}
        <span className="mono">{String(snap.error ?? lb.error)}</span>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Top engineers (90 days)</div>
          <div className="muted" style={{ marginTop: 6 }}>
            Window ends <span className="mono">{lb.data.snapshot.window_end}</span>
            {snap.data?.as_of ? (
              <>
                {" "}
                · materialized <span className="mono">{snap.data.as_of}</span>
              </>
            ) : null}
          </div>
        </div>
        <span className="pill">Reads only precomputed rollups</span>
      </div>

      <div style={{ height: 14 }} />

      <table className="table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Engineer</th>
            <th>Impact</th>
            <th>Merges (90d)</th>
            <th>Weighted</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {lb.data.rows.map((r) => (
            <tr key={r.engineer_id}>
              <td style={{ width: 70 }}>{r.rank}</td>
              <td>
                <div style={{ fontWeight: 650 }}>{r.display_name}</div>
                <div className="mono">{r.github_login}</div>
              </td>
              <td className="score">{r.impact_score.toFixed(1)}</td>
              <td>{r.merges_90d}</td>
              <td className="mono">{r.weighted_merges_90d.toFixed(2)}</td>
              <td style={{ width: 160 }}>
                <Link to={`/engineer/${r.engineer_id}`} className="btn btnPrimary">
                  Drill down
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ height: 14 }} />

      <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
        Scoring is explainable: <span className="mono">0.3·throughput + 0.2·consistency + 0.2·review + 0.2·stability + 0.1·complexity</span> on a 0–100 pillar scale.
      </div>
    </div>
  );
}
