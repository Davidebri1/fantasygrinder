/**
 * Runs the optimizer off the main thread.
 *
 * Falls back to running in-thread when Workers are unavailable (older
 * browsers, some test environments) so the app never breaks over it.
 */
import { runOptimize } from "@/optimizer";
import type { OptimizeResult, OptimizerSettings, Player } from "@/optimizer/types";
import type { OptimizeRequest, OptimizeResponse } from "@/optimizer/worker";

export function runOptimizerAsync(
  settings: OptimizerSettings,
  players: Player[],
): Promise<OptimizeResult> {
  if (typeof Worker === "undefined") {
    return Promise.resolve(runOptimize(settings, players));
  }
  return new Promise<OptimizeResult>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("@/optimizer/worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      resolve(runOptimize(settings, players));
      return;
    }
    const cleanup = () => worker.terminate();
    worker.onmessage = (event: MessageEvent<OptimizeResponse>) => {
      cleanup();
      if (event.data?.ok && event.data.result) resolve(event.data.result);
      else reject(new Error(event.data?.error ?? "The optimizer failed."));
    };
    worker.onerror = () => {
      cleanup();
      // Worker could not start — run it here instead of failing outright.
      try {
        resolve(runOptimize(settings, players));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    const request: OptimizeRequest = { settings, players };
    worker.postMessage(request);
  });
}
