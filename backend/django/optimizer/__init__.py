"""Optimizer engine for Fantasy Grinder.

This package is the **kernel** of the backend. It is intentionally
framework-free (no Django, no DRF, no DRF serializers) so it can be:

1. Unit-tested in milliseconds without a database.
2. Called from a synchronous HTTP request, a Celery worker, or a CLI.
3. Reused in the parity-test harness against the legacy Dart reference.

## Layering

```
api/views.py  ─►  apps/<sport>/services.py  ─►  optimizer/run.py  ─►  this package
                                                       │
                                                       ▼
                                            optimizer/schema.py        (dataclasses)
                                            optimizer/strategies.py     (5 strats)
                                            optimizer/sports/{nba,mma,golf}.py   (constraints)
                                            optimizer/engines/{milp_pulp,milp_ortools}.py   (solvers)
                                            optimizer/simulation/{cholesky,monte_carlo}.py   (sampling)
```

The contract:
- Input is a list of sport-agnostic :class:`Player` records plus a sport-keyed :class:`OptimizerSettings`.
- Output is :class:`OptimizeResult`, with a list of :class:`Lineup` objects sorted by score desc.
"""
from __future__ import annotations

from .schema import (
    ContestType,
    Lineup,
    OptimizeResult,
    OptimizerSettings,
    Player,
    SlotAssignment,
    Strategy,
)
from .run import run_optimization

__all__ = [
    "ContestType",
    "Lineup",
    "OptimizeResult",
    "OptimizerSettings",
    "Player",
    "SlotAssignment",
    "Strategy",
    "run_optimization",
]
