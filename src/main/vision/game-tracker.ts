import { Chess, Move } from 'chess.js';
import { BoardGrid, SquareContent, PieceSymbol } from '../../shared/types';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a chess.js board representation to our BoardGrid format.
 * chess.js board(): row 0 = rank 8, col 0 = file a.
 * Our grid: grid[rank][file], rank 0 = rank 8, rank 7 = rank 1.
 */
function chessToGrid(game: Chess): BoardGrid {
  const board = game.board();
  const grid: BoardGrid = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const cell = board[r][f];
      if (cell) {
        const piece =
          cell.color === 'w'
            ? (cell.type.toUpperCase() as PieceSymbol)
            : (cell.type.toLowerCase() as PieceSymbol);
        grid[r][f] = piece;
      }
    }
  }
  return grid;
}

/**
 * Score how well a chess position matches a classified grid.
 *
 * Scoring:
 * - Both empty:           +1   (trivial agreement)
 * - Both same piece:      +3   (strong confirmation)
 * - Both occupied, wrong: +0.5 (at least occupancy agrees)
 * - One empty one not:     0   (clear disagreement)
 *
 * Returns a score in [0, 3*64] (higher = better match).
 */
function scoreGrid(gameGrid: BoardGrid, classifiedGrid: BoardGrid): number {
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const expected = gameGrid[r][f];
      const observed = classifiedGrid[r][f];

      if (expected === null && observed === null) {
        score += 1; // both empty
      } else if (expected !== null && observed !== null) {
        if (expected === observed) {
          score += 3; // exact piece match
        } else {
          score += 0.5; // both occupied but wrong piece
        }
      }
      // else: one empty one occupied → 0
    }
  }
  return score;
}

// ── Game Tracker ─────────────────────────────────────────────────────────────

/**
 * Tracks the chess game by combining imperfect visual classification with
 * chess.js legal-move constraints.
 *
 * On each frame the gradient classifier produces a noisy 8×8 grid (~60/64
 * squares correct).  The tracker enumerates all legal 1/2/3-move
 * continuations from its internal game state, scores each resulting position
 * against the classified grid, and applies the best match.
 *
 * This is robust because:
 * 1. The classifier only needs to be *mostly* right — chess rules disambiguate
 * 2. Self-correcting: reads the actual board each frame, not just diffs
 * 3. Side to move, castling, en passant tracked automatically by chess.js
 * 4. Works with any piece theme, highlight colour, or chess site
 */
export class GameTracker {
  private game: Chess;

  constructor() {
    this.game = new Chess();
  }

  /** Current FEN from internal game state. */
  get fen(): string {
    return this.game.fen();
  }

  /** Current move number. */
  get moveNumber(): number {
    return this.game.moveNumber();
  }

  /** Full move history. */
  get history(): string[] {
    return this.game.history();
  }

  /** Whether the tracker has been initialised (always true — starts at initial position). */
  get isInitialised(): boolean {
    return true;
  }

  /** Reset to starting position. */
  reset(): void {
    this.game = new Chess();
    console.log('[GameTracker] Reset to starting position');
  }

  /**
   * Process a classified board grid.  Finds the legal move sequence (0–3 moves)
   * from the current game state whose resulting position best matches the
   * classified grid, applies those moves, and returns the updated FEN.
   *
   * Returns `{ fen, confidence, movesApplied }` or `null` if no legal
   * continuation matches well enough.
   */
  processClassifiedGrid(classifiedGrid: BoardGrid): {
    fen: string;
    confidence: number;
    movesApplied: string[];
  } | null {
    // Maximum possible score (every square = +3 for piece match or +1 for empty)
    const currentGrid = chessToGrid(this.game);
    const maxScore = this.computeMaxScore(currentGrid);

    // Start with score for "0 moves" (position unchanged)
    const currentScore = scoreGrid(currentGrid, classifiedGrid);
    let bestScore = currentScore;
    let bestMoves: Move[] = [];

    console.log(
      `[GameTracker] Current position score: ${currentScore.toFixed(1)}/${maxScore.toFixed(1)} ` +
        `(${((currentScore / maxScore) * 100).toFixed(1)}%)`,
    );

    // Try 1-move continuations
    const firstMoves = this.game.moves({ verbose: true });
    for (const m1 of firstMoves) {
      this.game.move(m1);
      const grid1 = chessToGrid(this.game);
      const score1 = scoreGrid(grid1, classifiedGrid);
      if (score1 > bestScore) {
        bestScore = score1;
        bestMoves = [m1];
      }

      // Try 2-move continuations
      const secondMoves = this.game.moves({ verbose: true });
      for (const m2 of secondMoves) {
        this.game.move(m2);
        const grid2 = chessToGrid(this.game);
        const score2 = scoreGrid(grid2, classifiedGrid);
        if (score2 > bestScore) {
          bestScore = score2;
          bestMoves = [m1, m2];
        }

        // Try 3-move continuations
        const thirdMoves = this.game.moves({ verbose: true });
        for (const m3 of thirdMoves) {
          this.game.move(m3);
          const grid3 = chessToGrid(this.game);
          const score3 = scoreGrid(grid3, classifiedGrid);
          if (score3 > bestScore) {
            bestScore = score3;
            bestMoves = [m1, m2, m3];
          }
          this.game.undo();
        }

        this.game.undo();
      }

      this.game.undo();
    }

    const confidence = bestScore / maxScore;

    // Log the result
    if (bestMoves.length === 0) {
      console.log(
        `[GameTracker] No moves — position unchanged ` +
          `(score=${bestScore.toFixed(1)}, confidence=${(confidence * 100).toFixed(1)}%)`,
      );
    } else {
      console.log(
        `[GameTracker] Best match: ${bestMoves.map((m) => m.san).join(', ')} ` +
          `(score=${bestScore.toFixed(1)}, confidence=${(confidence * 100).toFixed(1)}%)`,
      );
    }

    // Require at least 85% confidence to accept
    if (confidence < 0.85) {
      console.warn(
        `[GameTracker] Confidence too low (${(confidence * 100).toFixed(1)}%) — tracking may be lost`,
      );
      // Still apply if it's the best we have and reasonably above chance
      if (confidence < 0.6) {
        return null;
      }
    }

    // Apply the best move sequence
    for (const m of bestMoves) {
      this.game.move(m);
    }

    return {
      fen: this.game.fen(),
      confidence,
      movesApplied: bestMoves.map((m) => m.san),
    };
  }

  /**
   * Compute the maximum possible score for a given position.
   * Empty squares score max 1, occupied squares score max 3.
   */
  private computeMaxScore(grid: BoardGrid): number {
    let max = 0;
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        max += grid[r][f] === null ? 1 : 3;
      }
    }
    return max;
  }
}

// ── Singleton instance ───────────────────────────────────────────────────────

let tracker: GameTracker | null = null;

export function getGameTracker(): GameTracker {
  if (!tracker) {
    tracker = new GameTracker();
  }
  return tracker;
}

export function resetGameTracker(): void {
  if (tracker) {
    tracker.reset();
  }
  tracker = null;
}
