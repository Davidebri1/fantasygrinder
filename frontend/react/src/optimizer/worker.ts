/**
 * Optimizer worker.
 *
 * The solver runs off the main thread so the page stays responsive while a
 * slate is being solved — a full live slate is ~240 players and the search
 * takes seconds, not milliseconds.
 */
import { runOptimize } from "./index";
import type { OptimizeResult, OptimizerSettings, Player } from "./types";

export interface OptimizeRequest {
  settings: OptimizerSettings;
  players: Player[];
}

export interface OptimizeResponse {
  ok: boolean;
  result?: OptimizeResult;
  error?: string;
}

self.onmessage = (event: MessageEvent<OptimizeRequest>) => {
  const { settings, players } = event.data ?? ({} as OptimizeRequest);
  try {
    const result = runOptimize(settings, players);
    (self as unknown as Worker).postMessage({ ok: true, result } satisfies OptimizeResponse);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } satisfies OptimizeResponse);
  }
};
