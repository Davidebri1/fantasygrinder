"""Shared helpers used by all sport modules."""
from __future__ import annotations

from typing import Sequence

from ..schema import Lineup, Player, Strategy


def lineup_from_solver_result_common(
    *,
    selected_idx: list[int],
    players: Sequence[Player],
    strategy: str,
    solver_backend: str,
    rank: int,
    slot_template: Sequence[str],
    score_multipliers: Sequence[float],
) -> Lineup:
    """Translate selected player indices into a :class:`Lineup`.

    Args:
        slot_template: e.g. ``("FLEX",) * 6`` for MMA/Golf, or the classic
            8-slot tuple for NBA. Multipliers align to slot order.
    """
    from ..schema import SlotAssignment as _SA

    assignments = []
    for i, sel_idx in enumerate(selected_idx):
        slot_idx = min(i, len(slot_template) - 1)
        assignments.append(
            _SA(
                slot=slot_template[slot_idx],
                score_multiplier=score_multipliers[slot_idx],
                player_id=players[sel_idx].id,
                player_name=players[sel_idx].name,
            )
        )

    total_salary = sum(players[i].salary for i in selected_idx)
    total_proj = sum(
        players[i].effective_projection * score_multipliers[min(j, len(score_multipliers) - 1)]
        for j, i in enumerate(selected_idx)
    )
    total_ceiling = sum(
        players[i].ceiling * score_multipliers[min(j, len(score_multipliers) - 1)]
        for j, i in enumerate(selected_idx)
    )
    teams = {players[i].team for i in selected_idx if players[i].team}
    games = set()

    lineup = Lineup(
        assignments=assignments,
        strategy=Strategy(strategy),
        solver_backend=solver_backend,
        rank=rank,
    )
    lineup.total_salary = total_salary
    lineup.total_projection = total_proj
    lineup.total_ceiling = total_ceiling
    lineup.teams = teams
    lineup.games = games
    return lineup
