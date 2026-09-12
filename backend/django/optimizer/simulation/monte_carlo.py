"""Batched Monte Carlo simulation runner.

The runner iterates ``simulation_count`` times and yields a vector of
simulated scores per eligible player. Caller (the optimizer) feeds each
row into the MILP solver as a separate objective.

We yield control between batches so a long simulation doesn't block the
event loop (relevant for the Django request/response path; we also use
this for ``async`` callers).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .cholesky import (
    CorrelationMatrix,
    box_muller_uniform_to_normal,
    sample_correlated,
)


@dataclass(slots=True)
class SimulatedSlate:
    means: np.ndarray  # shape (n,)
    stds: np.ndarray  # shape (n,)
    samples: np.ndarray  # shape (count, n), each row is one simulation

    @property
    def n_players(self) -> int:
        return int(self.means.shape[0])

    @property
    def n_sims(self) -> int:
        return int(self.samples.shape[0])


def run_batched(
    *,
    means: np.ndarray,
    stds: np.ndarray,
    correlation: CorrelationMatrix,
    sim_count: int,
    batch_size: int = 500,
    seed: int | None = None,
    progress: callable | None = None,
) -> np.ndarray:
    """Generate ``sim_count`` rows of correlated samples in batches.

    Yields to ``asyncio.sleep(0)`` between batches when called from async
    code so the UI thread can repaint. For sync callers the loop is just
    a tight iterator.
    """
    rng = np.random.default_rng(seed)
    cholesky_l = correlation.cholesky()
    out = np.empty((sim_count, len(means)), dtype=np.float64)
    cursor = 0
    while cursor < sim_count:
        end = min(cursor + batch_size, sim_count)
        chunk = end - cursor
        samples = sample_correlated(
            means=means,
            stds=stds,
            cholesky_l=cholesky_l,
            count=chunk,
            rng=rng,
        )
        out[cursor:end] = samples
        if progress is not None:
            progress(end, sim_count)
        cursor = end
    return out
