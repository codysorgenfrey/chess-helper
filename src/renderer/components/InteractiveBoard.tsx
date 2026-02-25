import React, { useState, useCallback, useMemo } from 'react';
import { Chess, Square } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { TouchBackend } from 'react-dnd-touch-backend';

interface InteractiveBoardProps {
  /** Called with the FEN after each move (or on reset). */
  onPositionChange: (fen: string) => void;
  /** Board width in pixels. */
  boardWidth?: number;
}

/**
 * A small interactive chessboard the user can manipulate to track game state.
 * Supports drag-and-drop and click moves, undo, reset, and flip.
 *
 * The internal Chess.js instance is the source of truth for the position.
 * Side to move, castling rights, en passant, etc. are all tracked automatically.
 */
export function InteractiveBoard({
  onPositionChange,
  boardWidth = 280,
}: InteractiveBoardProps): React.ReactElement {
  const [game, setGame] = useState(new Chess());
  const [boardOrientation, setBoardOrientation] = useState<'white' | 'black'>(
    'white',
  );
  const [moveHistory, setMoveHistory] = useState<string[]>([]);

  const position = useMemo(() => game.fen(), [game, moveHistory]);

  // Apply a move and notify parent
  const makeMove = useCallback(
    (sourceSquare: Square, targetSquare: Square, piece: string): boolean => {
      try {
        // Determine promotion piece if applicable
        const isPromotion =
          piece[1] === 'P' &&
          ((piece[0] === 'w' && targetSquare[1] === '8') ||
            (piece[0] === 'b' && targetSquare[1] === '1'));

        const move = game.move({
          from: sourceSquare,
          to: targetSquare,
          promotion: isPromotion ? 'q' : undefined, // auto-queen
        });

        if (move) {
          setMoveHistory((prev) => [...prev, move.san]);
          // Force re-render by creating new reference
          setGame(new Chess(game.fen()));
          onPositionChange(game.fen());
          return true;
        }
      } catch {
        // Illegal move
      }
      return false;
    },
    [game, onPositionChange],
  );

  const handleUndo = useCallback(() => {
    const move = game.undo();
    if (move) {
      setMoveHistory((prev) => prev.slice(0, -1));
      setGame(new Chess(game.fen()));
      onPositionChange(game.fen());
    }
  }, [game, onPositionChange]);

  const handleReset = useCallback(() => {
    const newGame = new Chess();
    setGame(newGame);
    setMoveHistory([]);
    onPositionChange(newGame.fen());
  }, [onPositionChange]);

  const handleFlip = useCallback(() => {
    setBoardOrientation((prev) => (prev === 'white' ? 'black' : 'white'));
  }, []);

  // Format recent moves for display
  const recentMoves = useMemo(() => {
    if (moveHistory.length === 0) return 'Starting position';
    const last6 = moveHistory.slice(-6);
    const startIdx = moveHistory.length - last6.length;
    const parts: string[] = [];
    for (let i = 0; i < last6.length; i++) {
      const globalIdx = startIdx + i;
      if (globalIdx % 2 === 0) {
        parts.push(`${Math.floor(globalIdx / 2) + 1}.${last6[i]}`);
      } else {
        parts.push(last6[i]);
      }
    }
    return parts.join(' ');
  }, [moveHistory]);

  // Status text
  const statusText = useMemo(() => {
    if (game.isCheckmate()) return 'Checkmate!';
    if (game.isDraw()) return 'Draw';
    if (game.isStalemate()) return 'Stalemate';
    if (game.isCheck())
      return game.turn() === 'w' ? 'White in check' : 'Black in check';
    return game.turn() === 'w' ? 'White to move' : 'Black to move';
  }, [game, moveHistory]);

  return (
    <div className="interactive-board">
      <div className="board-controls">
        <button
          className="board-btn"
          onClick={handleUndo}
          disabled={moveHistory.length === 0}
          title="Undo last move"
        >
          ↩
        </button>
        <span className="board-status">{statusText}</span>
        <button className="board-btn" onClick={handleFlip} title="Flip board">
          ⇅
        </button>
        <button
          className="board-btn"
          onClick={handleReset}
          title="Reset to starting position"
        >
          ↻
        </button>
      </div>

      <Chessboard
        id="chess-helper-board"
        position={position}
        onPieceDrop={makeMove}
        boardWidth={boardWidth}
        boardOrientation={boardOrientation}
        animationDuration={150}
        arePiecesDraggable={true}
        customDndBackend={TouchBackend}
        customDndBackendOptions={{ enableMouseEvents: true }}
        onPromotionCheck={() => false}
        customBoardStyle={{
          borderRadius: '4px',
          boxShadow: '0 2px 10px rgba(0, 0, 0, 0.5)',
        }}
        customDarkSquareStyle={{ backgroundColor: '#779952' }}
        customLightSquareStyle={{ backgroundColor: '#edeed1' }}
      />

      <div className="board-moves" title={moveHistory.join(' ')}>
        {recentMoves}
      </div>
    </div>
  );
}
