import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { GlobalSiteAppBar } from "@/components/GlobalSiteAppBar";

import { SportSelectionScreen } from "@/pages/SportSelectionScreen";
import { NbaHomeScreen } from "@/pages/NbaHomeScreen";
import { MmaHomeScreen } from "@/pages/MmaHomeScreen";
import { GolfHomeScreen } from "@/pages/GolfHomeScreen";

const titles: Record<string, string> = {
  "/": "Sport Selection",
  "/nba": "NBA Optimizer",
  "/mma": "MMA Optimizer",
  "/golf": "Golf Optimizer",
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
          <Route path="/nba" element={<NbaHomeScreen />} />
          <Route path="/mma" element={<MmaHomeScreen />} />
          <Route path="/golf" element={<GolfHomeScreen />} />
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
