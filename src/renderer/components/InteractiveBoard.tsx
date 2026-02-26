import React, {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from 'react';
import { Chess, Square } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { TouchBackend } from 'react-dnd-touch-backend';
import { AppMode, MoveEvaluation, HintResult } from '../../shared/types';
import { minimalPieces } from './MinimalPieces';

interface InteractiveBoardProps {
  /** Current app mode */
  mode: AppMode;
  /** Called after any move is made (user or bot). */
  onMoveMade?: (info: {
    fenBefore: string;
    moveUci: string;
    moveSan: string;
    fenAfter: string;
    isUserMove: boolean;
  }) => void;
  /** Called when the board is reset */
  onReset?: () => void;
  /** Called when the game ends (checkmate, stalemate, draw) */
  onGameOver?: () => void;
  /** Board width in pixels. */
  boardWidth?: number;
  /** Hint data to show on the board */
  hint?: HintResult | null;
  /** Move evaluation result to show */
  moveEvaluation?: MoveEvaluation | null;
  /** Whether a hint/eval request is in progress */
  isThinking?: boolean;
  /** Which color the player is (coach mode) */
  playerColor?: 'white' | 'black';
  /** Whether the bot is currently thinking (coach mode) */
  isBotThinking?: boolean;
  /** Ref that App uses to trigger a bot move on the board (coach mode) */
  triggerBotMoveRef?: React.MutableRefObject<
    ((moveUci: string, moveSan: string) => void) | null
  >;
  /** Called after an undo in coach mode with the restored FEN */
  onUndo?: (restoredFen: string) => void;
}

/**
 * A small interactive chessboard the user can manipulate to track game state.
 * Supports drag-and-drop and click moves, undo, reset, and flip.
 *
 * The internal Chess.js instance is the source of truth for the position.
 * Side to move, castling rights, en passant, etc. are all tracked automatically.
 */
export function InteractiveBoard({
  mode,
  onMoveMade,
  onReset,
  onGameOver,
  boardWidth: _boardWidthProp = 280,
  hint,
  moveEvaluation,
  isThinking,
  playerColor = 'white',
  isBotThinking = false,
  triggerBotMoveRef,
  onUndo,
}: InteractiveBoardProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [boardWidth, setBoardWidth] = useState(280);

  // Measure the container and size the board to fill it exactly
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && width > 0) setBoardWidth(Math.floor(width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const [game, setGame] = useState(new Chess());
  const [boardOrientation, setBoardOrientation] = useState<'white' | 'black'>(
    'white',
  );
  const [moveHistory, setMoveHistory] = useState<string[]>([]);
  // Undo stack for coach mode — stores the FEN *before* each half-move
  const [coachHistory, setCoachHistory] = useState<string[]>([]);

  // Free-placement position for modeler mode (FEN string)
  const [freePosition, setFreePosition] = useState(new Chess().fen());
  // Undo stack for modeler free mode
  const [freeHistory, setFreeHistory] = useState<string[]>([]);

  // Click-to-move state
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);

  // Keep board orientation in sync with player color
  useEffect(() => {
    setBoardOrientation(playerColor);
  }, [playerColor]);

  const position = useMemo(() => {
    if (mode === 'modeler') return freePosition;
    return game.fen();
  }, [mode, game, moveHistory, freePosition]);

  // Apply a bot move externally via ref
  useEffect(() => {
    if (triggerBotMoveRef) {
      triggerBotMoveRef.current = (moveUci: string, _moveSan: string) => {
        try {
          const fenBefore = game.fen();
          const move = game.move({
            from: moveUci.slice(0, 2) as Square,
            to: moveUci.slice(2, 4) as Square,
            promotion: moveUci[4] || undefined,
          });
          if (move) {
            setCoachHistory((prev) => [...prev, fenBefore]);
            setMoveHistory((prev) => [...prev, move.san]);
            const fenAfter = game.fen();
            const newGame = new Chess(fenAfter);
            setGame(newGame);
            onMoveMade?.({
              fenBefore,
              moveUci: move.from + move.to + (move.promotion || ''),
              moveSan: move.san,
              fenAfter,
              isUserMove: false,
            });
            if (
              newGame.isCheckmate() ||
              newGame.isDraw() ||
              newGame.isStalemate()
            ) {
              onGameOver?.();
            }
          }
        } catch {
          // Invalid bot move
        }
      };
    }
  }, [game, onMoveMade, onGameOver, triggerBotMoveRef]);

  // Apply a user move via drag/drop
  const makeMove = useCallback(
    (sourceSquare: Square, targetSquare: Square, piece: string): boolean => {
      setSelectedSquare(null);
      if (sourceSquare === targetSquare) return false;

      // ── Modeler mode: free placement (no rule enforcement) ──
      if (mode === 'modeler') {
        try {
          const fenBefore = freePosition;
          // Parse piece string from react-chessboard ("wP", "bN", etc.)
          const color = piece[0] === 'w' ? 'w' : 'b';
          const typeChar = piece[1].toLowerCase();
          const tempGame = new Chess(freePosition);

          // Remove from source
          tempGame.remove(sourceSquare);
          // Remove whatever is on target (capture)
          tempGame.remove(targetSquare);
          // Place piece on target
          tempGame.put(
            {
              type: typeChar as 'p' | 'n' | 'b' | 'r' | 'q' | 'k',
              color: color as 'w' | 'b',
            },
            targetSquare,
          );

          const fenAfter = tempGame.fen();

          // Push current position to undo stack
          setFreeHistory((prev) => [...prev, fenBefore]);
          setFreePosition(fenAfter);

          const label = `${piece[1]}${sourceSquare}-${targetSquare}`;
          setMoveHistory((prev) => [...prev, label]);
          onMoveMade?.({
            fenBefore,
            moveUci: sourceSquare + targetSquare,
            moveSan: label,
            fenAfter,
            isUserMove: true,
          });
          return true;
        } catch {
          return false;
        }
      }

      // ── Coach mode: enforce rules ──
      const sideToMove = game.turn() === 'w' ? 'white' : 'black';
      if (sideToMove !== playerColor || isBotThinking) {
        return false;
      }

      try {
        const fenBefore = game.fen();

        const isPromotion =
          piece[1] === 'P' &&
          ((piece[0] === 'w' && targetSquare[1] === '8') ||
            (piece[0] === 'b' && targetSquare[1] === '1'));

        const move = game.move({
          from: sourceSquare,
          to: targetSquare,
          promotion: isPromotion ? 'q' : undefined,
        });

        if (move) {
          setCoachHistory((prev) => [...prev, fenBefore]);
          setMoveHistory((prev) => [...prev, move.san]);
          const fenAfter = game.fen();
          const newGame = new Chess(fenAfter);
          setGame(newGame);
          onMoveMade?.({
            fenBefore,
            moveUci: move.from + move.to + (move.promotion || ''),
            moveSan: move.san,
            fenAfter,
            isUserMove: true,
          });
          if (
            newGame.isCheckmate() ||
            newGame.isDraw() ||
            newGame.isStalemate()
          ) {
            onGameOver?.();
          }
          return true;
        }
      } catch {
        // Illegal move
      }
      return false;
    },
    [
      game,
      onMoveMade,
      onGameOver,
      playerColor,
      isBotThinking,
      mode,
      freePosition,
    ],
  );

  // ── Click-to-move ──
  const handleSquareClick = useCallback(
    (square: Square) => {
      // Modeler mode: free placement
      if (mode === 'modeler') {
        if (selectedSquare) {
          if (selectedSquare === square) {
            setSelectedSquare(null);
            return;
          }
          try {
            const tempGame = new Chess(freePosition);
            const piece = tempGame.get(selectedSquare);
            if (piece) {
              const pieceStr =
                (piece.color === 'w' ? 'w' : 'b') + piece.type.toUpperCase();
              makeMove(selectedSquare, square, pieceStr);
            }
          } catch {
            // invalid position
          }
          setSelectedSquare(null);
          return;
        }
        try {
          const tempGame = new Chess(freePosition);
          const piece = tempGame.get(square);
          if (piece) setSelectedSquare(square);
        } catch {
          // invalid position
        }
        return;
      }

      // Coach mode
      if (selectedSquare) {
        if (selectedSquare === square) {
          setSelectedSquare(null);
          return;
        }
        const piece = game.get(selectedSquare);
        if (piece) {
          const pieceStr =
            (piece.color === 'w' ? 'w' : 'b') + piece.type.toUpperCase();
          const success = makeMove(selectedSquare, square, pieceStr);
          if (success) return; // makeMove already cleared selection
        }
        // If clicked another friendly piece, select it
        const clickedPiece = game.get(square);
        if (clickedPiece && clickedPiece.color === game.turn()) {
          setSelectedSquare(square);
          return;
        }
        setSelectedSquare(null);
        return;
      }

      // No selection — select a friendly piece
      const sideToMove = game.turn();
      const playerTurnChar = playerColor === 'white' ? 'w' : 'b';
      if (sideToMove !== playerTurnChar || isBotThinking) return;

      const piece = game.get(square);
      if (piece && piece.color === sideToMove) {
        setSelectedSquare(square);
      }
    },
    [
      selectedSquare,
      game,
      makeMove,
      mode,
      playerColor,
      isBotThinking,
      freePosition,
    ],
  );

  // Highlight selected square and legal move targets
  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    if (!selectedSquare) return styles;

    styles[selectedSquare] = { backgroundColor: 'rgba(255, 255, 0, 0.4)' };

    if (mode !== 'modeler') {
      try {
        const moves = game.moves({ square: selectedSquare, verbose: true });
        for (const move of moves) {
          const target = game.get(move.to as Square);
          if (target) {
            styles[move.to] = {
              background:
                'radial-gradient(transparent 51%, rgba(0,0,0,0.18) 51%)',
            };
          } else {
            styles[move.to] = {
              background:
                'radial-gradient(circle, rgba(0,0,0,0.2) 25%, transparent 25%)',
            };
          }
        }
      } catch {
        // position may be invalid
      }
    }

    return styles;
  }, [selectedSquare, game, moveHistory, mode]);

  const handleUndo = useCallback(() => {
    setSelectedSquare(null);
    if (mode === 'modeler') {
      // Modeler free mode: pop from our undo stack
      if (freeHistory.length > 0) {
        const prev = freeHistory[freeHistory.length - 1];
        setFreeHistory((h) => h.slice(0, -1));
        setFreePosition(prev);
        setMoveHistory((m) => m.slice(0, -1));
        onMoveMade?.({
          fenBefore: freePosition,
          moveUci: '',
          moveSan: 'undo',
          fenAfter: prev,
          isUserMove: true,
        });
      }
    } else {
      // Coach: undo 2 half-moves (bot + user) so it's the player's turn again.
      // We use coachHistory (a FEN stack) because the game instance is always
      // rebuilt from FEN via new Chess(fen) and therefore has no move history
      // for game.undo() to walk back through.
      const undoCount = coachHistory.length >= 2 ? 2 : coachHistory.length;
      if (undoCount > 0) {
        const restoredFen = coachHistory[coachHistory.length - undoCount];
        setCoachHistory((prev) => prev.slice(0, -undoCount));
        setMoveHistory((prev) => prev.slice(0, -undoCount));
        setGame(new Chess(restoredFen));
        onUndo?.(restoredFen);
      }
    }
  }, [game, mode, freeHistory, freePosition, onMoveMade, onUndo, coachHistory]);

  const handleReset = useCallback(() => {
    setSelectedSquare(null);
    const newGame = new Chess();
    setGame(newGame);
    setMoveHistory([]);
    setCoachHistory([]);
    setFreePosition(newGame.fen());
    setFreeHistory([]);
    onReset?.();
  }, [onReset]);

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

  // Reset when mode changes
  useEffect(() => {
    const newGame = new Chess();
    setGame(newGame);
    setMoveHistory([]);
    setCoachHistory([]);
    setFreePosition(newGame.fen());
    setFreeHistory([]);
    setSelectedSquare(null);
  }, [mode]);

  // Status text
  const statusText = useMemo(() => {
    if (mode === 'modeler') {
      return 'Free placement — drag pieces anywhere';
    }
    if (game.isCheckmate()) return 'Checkmate!';
    if (game.isDraw()) return 'Draw';
    if (game.isStalemate()) return 'Stalemate';
    if (isBotThinking) return 'Opponent thinking…';
    if (game.isCheck())
      return game.turn() === 'w' ? 'White in check' : 'Black in check';
    return game.turn() === 'w' ? 'White to move' : 'Black to move';
  }, [game, moveHistory, isBotThinking, mode]);

  return (
    <div className="interactive-board">
      <div className="board-controls">
        <button
          className="board-btn"
          onClick={handleUndo}
          disabled={
            mode === 'modeler'
              ? freeHistory.length === 0
              : moveHistory.length === 0
          }
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

      {/* Sizing container — ResizeObserver measures this to set boardWidth */}
      <div ref={containerRef} className="board-sizer">
        {(() => {
          const sq = boardWidth / 8;
          const labelSize = Math.max(12, Math.floor(sq * 0.35));
          const gutterWidth = labelSize + 4;
          const innerBoardWidth = boardWidth - gutterWidth;
          const innerSq = innerBoardWidth / 8;
          const ranks = Array.from({ length: 8 }, (_, i) =>
            boardOrientation === 'white' ? 8 - i : i + 1,
          );
          const files = Array.from({ length: 8 }, (_, i) =>
            boardOrientation === 'white'
              ? String.fromCharCode(97 + i)
              : String.fromCharCode(104 - i),
          );
          return (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex' }}>
                {/* Rank labels (left gutter) */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    width: gutterWidth,
                    flexShrink: 0,
                  }}
                >
                  {ranks.map((rank, i) => (
                    <div
                      key={`rank-${i}`}
                      style={{
                        height: innerSq,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: labelSize,
                        fontWeight: 700,
                        color: 'var(--text-secondary)',
                        userSelect: 'none',
                      }}
                    >
                      {rank}
                    </div>
                  ))}
                </div>
                {/* Board */}
                <Chessboard
                  id="chess-helper-board"
                  position={position}
                  onPieceDrop={makeMove}
                  onSquareClick={handleSquareClick}
                  customSquareStyles={squareStyles}
                  boardWidth={innerBoardWidth}
                  boardOrientation={boardOrientation}
                  animationDuration={150}
                  arePiecesDraggable={true}
                  customDndBackend={TouchBackend}
                  customDndBackendOptions={{ enableMouseEvents: true }}
                  onPromotionCheck={() => false}
                  customPieces={minimalPieces}
                  showBoardNotation={false}
                  customBoardStyle={{
                    borderRadius: '4px',
                    boxShadow: '0 2px 10px rgba(0, 0, 0, 0.5)',
                  }}
                  customDarkSquareStyle={{ backgroundColor: '#6b7c8f' }}
                  customLightSquareStyle={{ backgroundColor: '#dce3eb' }}
                />
              </div>
              {/* File labels (bottom gutter) */}
              <div
                style={{
                  display: 'flex',
                  marginLeft: gutterWidth,
                  height: labelSize + 4,
                }}
              >
                {files.map((file, i) => (
                  <div
                    key={`file-${i}`}
                    style={{
                      width: innerSq,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: labelSize,
                      fontWeight: 700,
                      color: 'var(--text-secondary)',
                      userSelect: 'none',
                    }}
                  >
                    {file}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </div>

      <div className="board-moves" title={moveHistory.join(' ')}>
        {recentMoves}
      </div>
    </div>
  );
}
