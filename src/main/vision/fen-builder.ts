import { Chess } from 'chess.js';
import { BoardGrid, SquareContent } from '../../shared/types';

/**
 * Convert an 8x8 board grid to a FEN string.
 *
 * Grid layout: grid[rank][file]
 *   rank 0 = rank 8 (top of board, black's back rank)
 *   rank 7 = rank 1 (bottom of board, white's back rank)
 *   file 0 = a-file, file 7 = h-file
 */
export function buildFEN(
  grid: BoardGrid,
  sideToMove: 'w' | 'b' = 'w',
  castlingRights = 'KQkq',
  enPassant = '-',
  halfmoveClock = 0,
  fullmoveNumber = 1
): string | null {
  try {
    // Build piece placement string (rank 8 first, rank 1 last)
    const rows: string[] = [];

    for (let rank = 0; rank < 8; rank++) {
      let row = '';
      let emptyCount = 0;

      for (let file = 0; file < 8; file++) {
        const piece: SquareContent = grid[rank][file];
        if (piece === null) {
          emptyCount++;
        } else {
          if (emptyCount > 0) {
            row += emptyCount.toString();
            emptyCount = 0;
          }
          row += piece;
        }
      }

      if (emptyCount > 0) {
        row += emptyCount.toString();
      }

      rows.push(row);
    }

    // Validate castling rights against actual piece positions
    const validatedCastling = validateCastlingRights(grid, castlingRights);

    const piecePlacement = rows.join('/');
    const fen = `${piecePlacement} ${sideToMove} ${validatedCastling} ${enPassant} ${halfmoveClock} ${fullmoveNumber}`;

    // Validate using chess.js
    try {
      const chess = new Chess(fen);
      console.log('[FenBuilder] Valid FEN:', fen);
      // If chess.js accepted it, return the validated FEN
      return chess.fen();
    } catch (e) {
      // chess.js validation failed — try to fix common issues
      console.warn('[FenBuilder] Invalid FEN:', fen);
      console.warn('[FenBuilder] chess.js error:', e instanceof Error ? e.message : String(e));
      const fixedFen = tryFixFEN(fen, sideToMove);
      if (fixedFen) {
        console.log('[FenBuilder] Fixed FEN:', fixedFen);
        return fixedFen;
      }
      console.error('[FenBuilder] Could not fix FEN — returning null');
      return null;
    }
  } catch (err) {
    console.error('[FenBuilder] Error building FEN:', err);
    return null;
  }
}

/**
 * Validate that castling rights are consistent with rook/king positions.
 */
function validateCastlingRights(grid: BoardGrid, castlingRights: string): string {
  if (castlingRights === '-') return '-';

  let valid = '';

  // White king must be on e1 for castling
  const whiteKingOnE1 = grid[7][4] === 'K';
  // Black king must be on e8
  const blackKingOnE8 = grid[0][4] === 'k';

  if (castlingRights.includes('K') && whiteKingOnE1 && grid[7][7] === 'R') valid += 'K';
  if (castlingRights.includes('Q') && whiteKingOnE1 && grid[7][0] === 'R') valid += 'Q';
  if (castlingRights.includes('k') && blackKingOnE8 && grid[0][7] === 'r') valid += 'k';
  if (castlingRights.includes('q') && blackKingOnE8 && grid[0][0] === 'r') valid += 'q';

  return valid || '-';
}

/**
 * Attempt to fix common FEN issues caused by misclassified pieces:
 *  1. Strip castling rights (kings may have moved).
 *  2. If still invalid, remove impossible extra pieces one at a time.
 * We never require kings to be on their starting squares — that's only
 * true at the start of the game.
 */
function tryFixFEN(fen: string, sideToMove: 'w' | 'b'): string | null {
  const parts = fen.split(' ');
  if (parts.length < 2) return null;

  const placement = parts[0];

  // Both kings must exist for any legal position.
  if (!placement.includes('K') || !placement.includes('k')) return null;

  // Try 1: strip castling rights — works for most mid-game positions.
  const attempt1 = `${placement} ${sideToMove} - - 0 1`;
  try {
    return new Chess(attempt1).fen();
  } catch {
    // fall through
  }

  return null;
}

/**
 * Get a human-readable description of what's on the board
 * (useful for debugging classification results).
 */
export function describeBoardGrid(grid: BoardGrid): string {
  const lines: string[] = [];
  const files = 'abcdefgh';
  const ranks = '87654321';

  for (let rank = 0; rank < 8; rank++) {
    let line = `${ranks[rank]} |`;
    for (let file = 0; file < 8; file++) {
      const piece = grid[rank][file];
      line += ` ${piece ?? '.'}`;
    }
    lines.push(line);
  }
  lines.push('  +-----------------');
  lines.push(`    ${files.split('').join(' ')}`);
  return lines.join('\n');
}

/**
 * Validate that a FEN string is legal using chess.js.
 */
export function validateFEN(fen: string): { valid: boolean; error?: string } {
  try {
    new Chess(fen);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) };
  }
}
