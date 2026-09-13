import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { GlobalSiteAppBar } from "@/components/GlobalSiteAppBar";

import { SportSelectionScreen } from "@/pages/SportSelectionScreen";
import { SportOptimizerScreen } from "@/pages/SportOptimizerScreen";
import { BrowseScreen } from "@/pages/BrowseScreen";

const titles: Record<string, string> = {
  "/": "Sport Selection",
  "/nba": "NBA Optimizer",
  "/mma": "MMA Optimizer",
  "/golf": "Golf Optimizer",
  "/browse": "Browse",
};

export default function App() {
  const location = useLocation();
  const pageTitle = titles[location.pathname] ?? "Fantasy Grinder";
  return (
    <>
      <GlobalSiteAppBar pageTitle={pageTitle} />
      <main className="max-w-7xl mx-auto px-6 py-6">
        <Routes>
          <Route path="/" element={<SportSelectionScreen />} />
          <Route path="/nba" element={<SportOptimizerScreen sport="nba" />} />
          <Route path="/mma" element={<SportOptimizerScreen sport="mma" />} />
          <Route path="/golf" element={<SportOptimizerScreen sport="golf" />} />
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
