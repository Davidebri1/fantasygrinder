import { useState } from "react";
import { useImportCsv, useImportExcel } from "@/lib/queries";
import { Player, type Sport } from "@/types";
import { useAppStore } from "@/store";

interface Props {
  sport: Sport;
  open: boolean;
  onClose: () => void;
}

export function ImportDialog({ sport, open, onClose }: Props) {
  const [tab, setTab] = useState<"csv" | "excel">("csv");
  const importCsv = useImportCsv();
  const importExcel = useImportExcel();
  const setPlayers = useAppStore((s) => s.setPlayers);

  if (!open) return null;

  const handleFile = async (file: File) => {
    const mut = tab === "csv" ? importCsv : importExcel;
    const result = await new Promise<{ unwrap: () => Promise<{ players: Player[] }> }>(
      // The mutation hook's API: `mutateAsync`-style is invoked via the wrapper below.
      (resolve, reject) => {
        try {
          (async () => {
            const data = await mut.mutateAsync({ sport, file });
            resolve({ unwrap: async () => data });
          })();
        } catch (e) {
          reject(e);
        }
      },
    );
    const data = await result.unwrap();
    setPlayers(sport, data.players);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40">
      <div className="bg-white rounded-lg shadow-2xl w-[520px] max-w-[90vw] p-6">
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-lg font-semibold">Import {sport.toUpperCase()} Roster</h2>
          <button onClick={onClose} className="text-ink-subtle hover:text-ink">×</button>
        </div>
        <div className="flex gap-2 mb-4">
          {(["csv", "excel"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-sm rounded-md ${tab === t ? "bg-brand text-white" : "bg-slate-100 text-ink-muted hover:bg-slate-200"}`}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>
        <label className="block border-2 border-dashed border-slate-300 rounded-lg p-8 text-center cursor-pointer hover:border-brand">
          <input
            type="file"
            accept={tab === "csv" ? ".csv,text/csv" : ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <div className="text-ink-muted">
            Click to upload a DraftKings {tab.toUpperCase()} file
          </div>
          <div className="text-xs text-ink-subtle mt-2">
            Supported columns: Name, Position, Salary, Game Info, …
          </div>
        </label>
        {(importCsv.isPending || importExcel.isPending) && (
          <div className="mt-3 text-sm text-ink-muted">Uploading…</div>
        )}
        {(importCsv.isError || importExcel.isError) && (
          <div className="mt-3 text-sm text-accent-danger">
            Import failed. Check file format and try again.
          </div>
        )}
      </div>
    </div>
  );
}
