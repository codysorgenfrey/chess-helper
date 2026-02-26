export interface EngineMove {
  rank: number; // 1 = best
  uci: string; // e.g. "e2e4"
  san: string; // e.g. "e4"
  scoreCp: number | null; // centipawns (positive = good for side to move)
  mateIn: number | null; // null if not mate
  depth: number;
  pv: string[]; // Principal variation (UCI moves)
}

export interface HintResult {
  bestMove: EngineMove;
  fen: string;
  coachingHint: string; // Textual coaching guidance (doesn't reveal the exact move)
}

/** App operating mode */
export type AppMode = 'modeler' | 'coach';

/** Difficulty level 1-5 for the bot opponent */
export type BotDifficulty = 1 | 2 | 3 | 4 | 5;

/** An engine move enriched with a human-readable description */
export interface AnalyzedMove extends EngineMove {
  description: string;
}

/** Result of a full position analysis for the modeler */
export interface PositionAnalysis {
  fen: string;
  moves: AnalyzedMove[];
  error?: string;
}

export interface BotMoveResult {
  moveUci: string;
  moveSan: string;
  fen: string; // FEN after the bot's move
}

export type MoveQuality =
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder';

export interface MoveEvaluation {
  userMoveSan: string;
  userMoveUci: string;
  userMoveScoreCp: number | null;
  userMoveMateIn: number | null;
  bestMoveSan: string;
  bestMoveUci: string;
  bestMoveScoreCp: number | null;
  bestMoveMateIn: number | null;
  quality: MoveQuality;
  explanation: string;
  centipawnLoss: number;
}

export type StatusType =
  | 'idle'
  | 'capturing'
  | 'detecting'
  | 'classifying'
  | 'analyzing'
  | 'done'
  | 'error';

export interface StatusUpdate {
  status: StatusType;
  message: string;
}
