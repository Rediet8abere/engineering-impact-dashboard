import { Link } from "react-router-dom";
import { API_URL } from "../api/client";
import { useLeaderboard, useSnapshot } from "../api/hooks";

function isLikelyNetworkFailure(error: unknown): boolean {
  if (error instanceof TypeError) {
    const m = error.message.toLowerCase();
    return m.includes("fetch") || m.includes("network") || m.includes("failed to load");
  }
  const s = String(error);
  return (
    s.includes("Failed to fetch") ||
    s.includes("NetworkError") ||
    s.includes("Load failed") ||
    s.toLowerCase().includes("network request failed")
  );
}

function viteApiBaseLabel(): string {
  if (import.meta.env.DEV) {
    return "(dev — /api on this origin; Vite proxies to the API)";
  }
  return API_URL || "(same page origin — relative /api)";
}

export function LeaderboardPage() {
  const snap = useSnapshot();
  const lb = useLeaderboard(5);

  if (snap.isLoading || lb.isLoading) return <div className="panel">Loading…</div>;
  if (snap.isError || lb.isError) {
    const err = snap.error ?? lb.error;
    const network = isLikelyNetworkFailure(err);

    return (
      <div className="panel error">
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Failed to load dashboard</div>
        {network ? (
          <div className="muted" style={{ fontSize: 14, lineHeight: 1.55 }}>
            <p style={{ margin: "0 0 8px" }}>
              The browser could not complete the request to the API (<span className="mono">{String(err)}</span>). This
              is often <strong>CORS</strong> or connectivity when the UI and API are on different hosts.
            </p>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              <li>
                API base for this build: <span className="mono">{viteApiBaseLabel()}</span>
              </li>
              <li>
                On <strong>Render</strong> (API service): remove <span className="mono">CORS_ORIGIN</span> if it is only{" "}
                <span className="mono">http://localhost:5173</span>, or set a comma-separated list that includes your{" "}
                <strong>production UI origin</strong> (exact scheme + host, no trailing slash), e.g.{" "}
                <span className="mono">CORS_ORIGIN=http://localhost:5173,https://your-web.onrender.com</span>.
              </li>
            </ul>
          </div>
        ) : import.meta.env.DEV ? (
          <div className="muted" style={{ fontSize: 14 }}>
            Run the API (e.g. <span className="mono">npm run dev -w server</span> on port 4000). This dev server proxies{" "}
            <span className="mono">/api</span> there. <span className="mono">{String(err)}</span>
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 14 }}>
            <span className="mono">{String(err)}</span>
          </div>
        )}
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
