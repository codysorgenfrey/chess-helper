import React from 'react';
import { EngineMove } from '../../shared/types';
import { MoveRow } from './MoveRow';

interface MoveListProps {
  moves: EngineMove[];
}

export function MoveList({ moves }: MoveListProps): React.ReactElement {
  if (moves.length === 0) {
    return <div className="move-list-empty">No moves found</div>;
  }

  // Find best score for bar normalization
  const bestScore = moves[0]?.scoreCp ?? 0;

  return (
    <div className="move-list" role="list" aria-label="Best moves">
      <div className="move-list-header">
        <span className="col-rank">#</span>
        <span className="col-move">Move</span>
        <span className="col-eval">Eval</span>
        <span className="col-bar">Strength</span>
      </div>
      {moves.map((move, idx) => (
        <MoveRow
          key={`${move.uci}-${idx}`}
          move={move}
          bestScore={bestScore}
        />
      ))}
    </div>
  );
}
