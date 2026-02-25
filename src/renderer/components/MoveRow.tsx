import React from 'react';
import { EngineMove } from '../../shared/types';

interface MoveRowProps {
  move: EngineMove;
  bestScore: number;
}

export function MoveRow({ move, bestScore }: MoveRowProps): React.ReactElement {
  const evalText = formatEval(move);
  const barPercent = computeBarPercent(move, bestScore);
  const evalClass = getEvalClass(move);

  return (
    <div className={`move-row ${move.rank === 1 ? 'move-row--best' : ''}`} role="listitem">
      <span className="col-rank">{move.rank}</span>

      <span className="col-move">
        {move.rank === 1 && <span className="best-indicator">▶ </span>}
        <strong>{move.san || move.uci}</strong>
      </span>

      <span className={`col-eval ${evalClass}`}>{evalText}</span>

      <span className="col-bar">
        <div className="eval-bar-track">
          <div
            className={`eval-bar-fill ${evalClass}`}
            style={{ width: `${barPercent}%` }}
          />
        </div>
      </span>
    </div>
  );
}

function formatEval(move: EngineMove): string {
  if (move.mateIn !== null) {
    if (move.mateIn === 0) return 'Mate';
    const sign = move.mateIn > 0 ? '+' : '';
    return `M${sign}${move.mateIn}`;
  }
  if (move.scoreCp === null) return '?';
  const pawns = move.scoreCp / 100;
  const sign = pawns >= 0 ? '+' : '';
  return `${sign}${pawns.toFixed(2)}`;
}

function computeBarPercent(move: EngineMove, bestScore: number): number {
  if (move.mateIn !== null) {
    // Mate moves get full or near-full bar
    return move.mateIn > 0 ? 100 : 15;
  }

  if (move.scoreCp === null) return 0;

  // Normalize relative to best score
  // Map: bestScore → 95%, bestScore - 300cp → 20%
  const cp = move.scoreCp;
  const range = 300; // centipawns range to display
  const maxPct = 95;
  const minPct = 15;

  if (bestScore === 0) {
    // Near-equal position
    const pct = 50 + (cp / range) * 40;
    return Math.max(minPct, Math.min(maxPct, pct));
  }

  const ratio = cp / Math.abs(bestScore);
  const pct = minPct + (maxPct - minPct) * Math.max(0, ratio);
  return Math.max(minPct, Math.min(maxPct, pct));
}

function getEvalClass(move: EngineMove): string {
  if (move.mateIn !== null) {
    return move.mateIn > 0 ? 'eval--mate-win' : 'eval--mate-lose';
  }
  if (move.scoreCp === null) return '';
  if (move.scoreCp >= 150) return 'eval--winning';
  if (move.scoreCp >= 30) return 'eval--advantage';
  if (move.scoreCp >= -30) return 'eval--equal';
  if (move.scoreCp >= -150) return 'eval--slight-disadvantage';
  return 'eval--losing';
}
