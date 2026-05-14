import { Navigate, Route, Routes } from "react-router-dom";
import { EngineerPage } from "./pages/EngineerPage";
import { LeaderboardPage } from "./pages/LeaderboardPage";

export default function App() {
  return (
    <div className="app">
      <header className="header">
        <div className="headerInner">
          <div className="brand">Engineering Impact</div>
          <div className="muted">PostHog/posthog (demo data)</div>
        </div>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<LeaderboardPage />} />
          <Route path="/engineer/:engineerId" element={<EngineerPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
