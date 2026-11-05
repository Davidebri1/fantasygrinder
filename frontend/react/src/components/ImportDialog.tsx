import { useState } from "react";
import { importCsvFile, importExcelFile } from "@/lib/import-client";
import { parseDraftables } from "@/lib/dk-draftables";
import { type Sport } from "@/types";
import { useAppStore } from "@/store";

interface Props {
  sport: Sport;
  open: boolean;
  onClose: () => void;
}

export function ImportDialog({ sport, open, onClose }: Props) {
  const [tab, setTab] = useState<"csv" | "excel" | "dk">("csv");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const setPlayers = useAppStore((s) => s.setPlayers);

  if (!open) return null;

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    setCount(null);
    try {
      const players =
        tab === "csv"
          ? await importCsvFile(file, sport)
          : tab === "excel"
            ? await importExcelFile(file, sport)
            : parseDraftables(await file.text(), sport);
      setPlayers(sport, players);
      setCount(players.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That file could not be read.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-chrome-deep/70">
      <div className="bg-surface-1 border border-line rounded-3 shadow-3 w-[520px] max-w-[90vw] p-6">
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-lg font-semibold">Import {sport.toUpperCase()} Roster</h2>
          <button onClick={onClose} className="text-ink-subtle hover:text-ink">
            &times;
          </button>
        </div>
        <div className="flex gap-2 mb-4">
          {(["csv", "excel", "dk"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-sm rounded-2 ${tab === t ? "bg-brand text-white" : "bg-surface-2 text-ink-muted hover:bg-surface-3"}`}
            >
              {t === "dk" ? "DraftKings JSON" : t.toUpperCase()}
            </button>
          ))}
        </div>
        <label className="block border-2 border-dashed border-line-strong rounded-3 p-8 text-center cursor-pointer hover:border-brand">
          <input
            type="file"
            accept={
              tab === "csv"
                ? ".csv,text/csv"
                : tab === "dk"
                  ? ".json,application/json"
                  : ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            }
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
          <div className="text-ink-muted">
            {tab === "dk"
              ? "Click to upload a DraftKings JSON file"
              : `Click to upload a DraftKings ${tab.toUpperCase()} file`}
          </div>
          <div className="text-xs text-ink-subtle mt-2">
            {tab === "dk"
              ? "The JSON export from DraftKings — it carries the real DraftKings salaries and projections."
              : "Supported columns: Name, Position, Salary, Game Info, …"}
          </div>
          <div className="text-xs text-ink-subtle mt-1">
            Parsed in your browser — nothing is uploaded anywhere.
          </div>
        </label>
        {busy && <div className="mt-3 text-sm text-ink-muted">Reading file…</div>}
        {count !== null && (
          <div className="mt-3 text-sm text-good">
            Loaded {count} players. This replaces the live pool until the next refresh.
          </div>
        )}
        {error && <div className="mt-3 text-sm text-danger">{error}</div>}
      </div>
    </div>
  );
}
