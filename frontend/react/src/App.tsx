import { Link, Route, Routes, useLocation } from "react-router-dom";
import { GlobalSiteAppBar } from "@/components/GlobalSiteAppBar";
import { AuroraBackdrop } from "@/components/AuroraBackdrop";

import { SportSelectionScreen } from "@/pages/SportSelectionScreen";
import { SportOptimizerScreen } from "@/pages/SportOptimizerScreen";
import { BrowseScreen } from "@/pages/BrowseScreen";

const titles: Record<string, string> = {
  "/": "Sport Selection",
  "/nba": "NBA Optimizer",
  "/nfl": "NFL Optimizer",
  "/mma": "MMA Optimizer",
  "/golf": "Golf Optimizer",
  "/browse": "Browse",
};

export default function App() {
  const location = useLocation();
  const pageTitle = titles[location.pathname] ?? "Outlier";
  return (
    <>
      <AuroraBackdrop />
      <GlobalSiteAppBar pageTitle={pageTitle} />
      <main className="relative mx-auto max-w-shell px-6 py-6">
        <Routes>
          <Route path="/" element={<SportSelectionScreen />} />
          {/*
            The key forces a fresh mount per sport. Without it the same
            component instance is reused when you move between two sport
            routes, and the new sport's first build runs against the old
            sport's settings — including a stack rule naming a game that
            does not exist on the new slate.
          */}
          <Route path="/nba" element={<SportOptimizerScreen key="nba" sport="nba" />} />
          <Route path="/nfl" element={<SportOptimizerScreen key="nfl" sport="nfl" />} />
          <Route path="/mma" element={<SportOptimizerScreen key="mma" sport="mma" />} />
          <Route path="/golf" element={<SportOptimizerScreen key="golf" sport="golf" />} />
          <Route path="/browse" element={<BrowseScreen />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </>
  );
}

function NotFound() {
  return (
    <div className="py-24 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-ink-subtle mt-2">
        Go back to <Link to="/" className="text-brand underline">sport selection</Link>.
      </p>
    </div>
  );
}
