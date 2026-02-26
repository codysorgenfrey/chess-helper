/**
 * useChessEngine.ts
 *
 * React hook that owns the Stockfish WASM engine instance and exposes
 * chess analysis, hints, move evaluation, and bot-play functionality.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Chess } from 'chess.js';
import { StockfishWorker } from './StockfishWorker';
import {
  EngineMove,
  HintResult,
  MoveEvaluation,
  MoveQuality,
  AnalyzedMove,
  PositionAnalysis,
  BotMoveResult,
  BotDifficulty,
  StatusUpdate,
} from '../shared/types';

// ── Settings (replaces electron-store) ──────────────────────────────────────

const ANALYSIS_DEPTH = 18;
const MULTI_PV = 5;

// ── Bot difficulty config (from ipc-handlers.ts) ─────────────────────────────

const BOT_DIFFICULTY_CONFIG: Record<
  1 | 2 | 3 | 4 | 5,
  {
    depth: number;
    multiPV: number;
    pickFromTopN: number;
    blunderChance: number;
  }
> = {
  1: { depth: 4, multiPV: 8, pickFromTopN: 8, blunderChance: 0.3 },
  2: { depth: 6, multiPV: 6, pickFromTopN: 5, blunderChance: 0.15 },
  3: { depth: 10, multiPV: 4, pickFromTopN: 3, blunderChance: 0.05 },
  4: { depth: 14, multiPV: 3, pickFromTopN: 2, blunderChance: 0.02 },
  5: { depth: 18, multiPV: 1, pickFromTopN: 1, blunderChance: 0.0 },
};

// ── Theme detection (from ipc-handlers.ts) ──────────────────────────────────

function detectThemes(fen: string, move: EngineMove): string[] {
  const themes: string[] = [];
  const san = move.san || '';
  const uci = move.uci || '';
  const pv = move.pv || [];

  try {
    const game = new Chess(fen);
    const sideToMove = game.turn();

    if (game.isCheck()) {
      themes.push('You need to get out of check first');
    }

    const isCapture = san.includes('x');
    const isCheck = san.includes('+');
    const isMate = san.includes('#');
    const isCastle = san === 'O-O' || san === 'O-O-O';

    const moveResult = game.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4] || undefined,
    });
    if (!moveResult) return themes;

    if (isCapture) {
      const capturedPiece = moveResult.captured;
      const pieceValues: Record<string, number> = {
        p: 1,
        n: 3,
        b: 3,
        r: 5,
        q: 9,
      };
      const movingPieceValue = pieceValues[moveResult.piece] ?? 0;
      const capturedValue = capturedPiece
        ? (pieceValues[capturedPiece] ?? 0)
        : 0;
      if (capturedValue > movingPieceValue) {
        themes.push('This wins material — you capture a more valuable piece');
      } else if (capturedValue === movingPieceValue) {
        themes.push('This is an even trade');
      }
    }

    if (pv.length >= 2) {
      // placeholder for discovered attack detection
    }

    if (isCastle) {
      themes.push('Castling improves king safety and connects your rooks');
    }
    if (isCheck) {
      themes.push('This gives check, forcing your opponent to respond');
    }
    if (isMate) {
      themes.push('This is checkmate!');
    }

    if (moveResult.piece === 'p') {
      const targetFile = uci[2];
      const targetRank = parseInt(uci[3]);
      if (
        (targetRank === 4 || targetRank === 5) &&
        'cdef'.includes(targetFile)
      ) {
        themes.push('This fights for central control with a pawn');
      }
      if (
        (sideToMove === 'w' && targetRank >= 6) ||
        (sideToMove === 'b' && targetRank <= 3)
      ) {
        themes.push(
          'This is a dangerous passed pawn advancing toward promotion',
        );
      }
    }

    const moveNumber = parseInt(fen.split(' ')[5] || '1');
    if (moveNumber <= 10) {
      if (moveResult.piece === 'n' || moveResult.piece === 'b') {
        themes.push(
          'Developing a minor piece toward the center is good opening play',
        );
      }
    }

    if (moveResult.piece === 'r') {
      themes.push('Rooks are strongest on open files and the 7th rank');
    }

    if (moveResult.piece === 'n') {
      const targetFile = uci[2];
      const targetRank = parseInt(uci[3]);
      if ('cdef'.includes(targetFile) && targetRank >= 3 && targetRank <= 6) {
        themes.push(
          'Knights are powerful in the center where they control many squares',
        );
      }
      if (targetFile === 'a' || targetFile === 'h') {
        themes.push(
          'A knight on the rim is dim — it controls fewer squares on the edge',
        );
      }
    }

    if (pv.length >= 3) {
      themes.push(`The engine sees a plan extending ${pv.length} moves deep`);
    }

    game.undo();
  } catch {
    // return what we have
  }

  return themes;
}

// ── Coaching hint generator (from ipc-handlers.ts) ───────────────────────────

function generateCoachingHint(
  move: EngineMove,
  fen: string,
  allMoves: EngineMove[],
): string {
  const san = move.san || '';
  const uci = move.uci || '';
  const scoreCp = move.scoreCp ?? 0;

  const isCapture = san.includes('x');
  const isCheck = san.includes('+');
  const isMate =
    san.includes('#') ||
    (move.mateIn !== null && move.mateIn > 0 && move.mateIn <= 5);
  const isCastle = san === 'O-O' || san === 'O-O-O';
  const isPromotion = san.includes('=');

  const pieceChar = san[0];
  const pieceNames: Record<string, string> = {
    K: 'king',
    Q: 'queen',
    R: 'rook',
    B: 'bishop',
    N: 'knight',
  };
  const isPawnMove = pieceChar === pieceChar.toLowerCase() && !isCastle;
  const pieceName = isPawnMove ? 'pawn' : pieceNames[pieceChar] || 'piece';

  const targetSquare = uci.slice(2, 4);
  const targetFile = targetSquare[0];
  const fileZone = 'abc'.includes(targetFile)
    ? 'queenside'
    : 'fgh'.includes(targetFile)
      ? 'kingside'
      : 'center';

  const themes = detectThemes(fen, move);

  const secondBestCp =
    allMoves.length > 1 ? (allMoves[1].scoreCp ?? 0) : scoreCp;
  const evalGap = scoreCp - secondBestCp;
  const isOnly = evalGap > 150;

  const moveNumber = parseInt(fen.split(' ')[5] || '1');
  const phase =
    moveNumber <= 10 ? 'opening' : moveNumber <= 25 ? 'middlegame' : 'endgame';

  const parts: string[] = [];

  if (isMate) {
    parts.push(
      "There's a forced checkmate! Carefully examine all checks and look at how your opponent's king is trapped.",
    );
    if (move.mateIn !== null && move.mateIn > 1) {
      parts.push(
        `It's a mate in ${move.mateIn} — follow the sequence of forcing moves.`,
      );
    }
    return parts.join(' ');
  }

  if (isOnly) {
    parts.push(
      "There's really only one good move here — the alternatives are significantly worse.",
    );
  }

  if (phase === 'opening') {
    if (isCastle) {
      parts.push(
        'In the opening, king safety is paramount. Think about castling to protect your king and activate your rook.',
      );
    } else if (isPawnMove) {
      parts.push(
        'Opening principle: control the center with pawns, then develop your pieces. Which pawn advances help you claim central space?',
      );
    } else if (pieceName === 'knight' || pieceName === 'bishop') {
      parts.push(
        "Opening principle: develop your minor pieces toward active squares that influence the center. Which piece hasn't moved yet?",
      );
    } else {
      parts.push(
        'Think about opening principles: center control, piece development, and king safety.',
      );
    }
  } else if (phase === 'middlegame') {
    if (isCapture && isCheck) {
      parts.push(
        "Look for a tactical combination — can you win material while also giving check? That's a powerful combination because your opponent is forced to deal with the check first.",
      );
    } else if (isCapture) {
      parts.push(
        `There's a tactical opportunity. Look at the ${fileZone} and consider: are any of your opponent's pieces undefended or overloaded?`,
      );
    } else if (isCheck) {
      parts.push(
        "Look for a forcing check. Checks are powerful because they limit your opponent's options. Think about which piece can deliver check and what that achieves.",
      );
    } else if (scoreCp > 200) {
      parts.push(
        `You have a strong advantage. Look for ways to increase pressure. Think about: which of your pieces isn't doing enough work on the ${fileZone}?`,
      );
    } else if (scoreCp < -100) {
      parts.push(
        "You're under pressure. Look for defensive resources — can you create counterplay or simplify the position?",
      );
    } else {
      parts.push(
        `Think about piece activity — your ${pieceName} could be more effective. Where can it exert maximum influence on the ${fileZone}?`,
      );
    }
  } else {
    // endgame
    if (isPawnMove) {
      parts.push(
        'In the endgame, passed pawns are extremely powerful. Think about advancing your pawns toward promotion — every tempo matters.',
      );
    } else if (pieceName === 'king') {
      parts.push(
        'In the endgame, the king becomes a fighting piece. Centralize your king and use it actively.',
      );
    } else {
      parts.push(
        'Endgame principle: activate your pieces, advance passed pawns, and keep your king centralized. Think about the pawn structure.',
      );
    }
  }

  const relevantThemes = themes
    .filter((t) => !t.includes('checkmate') || !isMate)
    .slice(0, 2);
  if (relevantThemes.length > 0) {
    parts.push(relevantThemes.join('. ') + '.');
  }

  if (isPromotion) {
    parts.push(
      'One of your pawns can promote! Can you safely push it to the back rank?',
    );
  }

  if (move.pv && move.pv.length >= 4 && !isMate) {
    parts.push(
      "Try to think a few moves ahead — if you play the best move, how will your opponent respond, and what's your follow-up?",
    );
  }

  return parts.join(' ');
}

// ── Move description for modeler (from ipc-handlers.ts) ──────────────────────

function describeMoveForModeler(move: EngineMove, fen: string): string {
  const san = move.san || '';
  const uci = move.uci || '';
  const scoreCp = move.scoreCp ?? 0;

  const isCapture = san.includes('x');
  const isCheck = san.includes('+');
  const isMate = san.includes('#');
  const isCastle = san === 'O-O' || san === 'O-O-O';
  const isPromotion = san.includes('=');

  const pieceChar = san[0];
  const pieceNames: Record<string, string> = {
    K: 'king',
    Q: 'queen',
    R: 'rook',
    B: 'bishop',
    N: 'knight',
  };
  const isPawnMove = pieceChar === pieceChar.toLowerCase() && !isCastle;
  const pieceName = isPawnMove ? 'Pawn' : pieceNames[pieceChar] || 'Piece';

  const targetSquare = uci.slice(2, 4);
  const themes = detectThemes(fen, move);
  const parts: string[] = [];

  if (isMate) {
    if (move.mateIn !== null) {
      parts.push(`Checkmate in ${Math.abs(move.mateIn)}.`);
    } else {
      parts.push('Delivers checkmate.');
    }
  } else if (move.mateIn !== null && move.mateIn > 0) {
    parts.push(`Forced mate in ${move.mateIn}.`);
  } else if (isCastle) {
    parts.push(san === 'O-O' ? 'Castles kingside.' : 'Castles queenside.');
    parts.push('Improves king safety and activates the rook.');
  } else if (isCapture && isCheck) {
    parts.push(`${pieceName} captures on ${targetSquare} with check.`);
  } else if (isCapture) {
    parts.push(`${pieceName} captures on ${targetSquare}.`);
  } else if (isCheck) {
    parts.push(`${pieceName} to ${targetSquare} with check.`);
  } else if (isPromotion) {
    const promoteTo = san.split('=')[1]?.[0] || 'Q';
    const promoName = pieceNames[promoteTo] || 'queen';
    parts.push(`Pawn promotes to ${promoName} on ${targetSquare}.`);
  } else {
    parts.push(`${pieceName} to ${targetSquare}.`);
  }

  const relevantThemes = themes.filter(
    (t) =>
      !t.includes('checkmate') &&
      !t.includes('check') &&
      !t.includes('Castling'),
  );
  if (relevantThemes.length > 0) {
    parts.push(relevantThemes[0]);
  }

  if (move.mateIn === null) {
    const evalPawns = scoreCp / 100;
    if (evalPawns > 3) parts.push('Winning position.');
    else if (evalPawns > 1) parts.push('Clear advantage.');
    else if (evalPawns > 0.3) parts.push('Slight edge.');
    else if (evalPawns > -0.3) parts.push('Equal position.');
    else if (evalPawns > -1) parts.push('Slightly worse.');
    else if (evalPawns > -3) parts.push('Disadvantage.');
    else parts.push('Losing position.');
  }

  return parts.join(' ');
}

// ── Move quality classification (from ipc-handlers.ts) ───────────────────────

function classifyMoveQuality(centipawnLoss: number): MoveQuality {
  if (centipawnLoss <= 0) return 'best';
  if (centipawnLoss <= 10) return 'excellent';
  if (centipawnLoss <= 30) return 'good';
  if (centipawnLoss <= 80) return 'inaccuracy';
  if (centipawnLoss <= 200) return 'mistake';
  return 'blunder';
}

// ── Explanation builder (from ipc-handlers.ts) ───────────────────────────────

function buildExplanation(
  quality: MoveQuality,
  userMoveSan: string,
  bestMoveSan: string,
  centipawnLoss: number,
  bestScoreCp: number | null,
  bestMateIn: number | null,
  userScoreCp: number | null,
  userMateIn: number | null,
  fen: string,
  _userMoveUci: string,
  _bestMoveUci: string,
): string {
  const parts: string[] = [];

  const bestEvalStr =
    bestMateIn !== null
      ? `mate in ${Math.abs(bestMateIn)}`
      : bestScoreCp !== null
        ? `${(bestScoreCp / 100).toFixed(1)}`
        : '?';

  const userEvalStr =
    userMateIn !== null
      ? `mate in ${Math.abs(userMateIn)}`
      : userScoreCp !== null
        ? `${(userScoreCp / 100).toFixed(1)}`
        : '?';

  const lossStr = (centipawnLoss / 100).toFixed(1);

  const bestPieceChar = bestMoveSan[0];
  const pieceNames: Record<string, string> = {
    K: 'king',
    Q: 'queen',
    R: 'rook',
    B: 'bishop',
    N: 'knight',
  };
  const userIsCapture = userMoveSan.includes('x');
  const bestIsCapture = bestMoveSan.includes('x');
  const userIsCheck = userMoveSan.includes('+') || userMoveSan.includes('#');
  const bestIsCheck = bestMoveSan.includes('+') || bestMoveSan.includes('#');
  const bestIsCastle = bestMoveSan === 'O-O' || bestMoveSan === 'O-O-O';

  const moveNumber = parseInt(fen.split(' ')[5] || '1');
  const phase =
    moveNumber <= 10 ? 'opening' : moveNumber <= 25 ? 'middlegame' : 'endgame';

  if (quality === 'best') {
    parts.push(`Excellent! ${userMoveSan} is the engine's top choice.`);
    if (userIsCapture && userIsCheck) {
      parts.push(
        'You found the key tactic — capturing with check forces your opponent to respond to the threat while you win material.',
      );
    } else if (userIsCheck) {
      parts.push(
        "This check creates a strong initiative. Forcing moves like checks limit your opponent's options.",
      );
    } else if (userIsCapture) {
      parts.push(
        'Good eye! You spotted the right capture when it was available.',
      );
    } else if (userMoveSan === 'O-O' || userMoveSan === 'O-O-O') {
      parts.push(
        'Good decision to castle. King safety is crucial, and you connected your rooks.',
      );
    } else if (phase === 'opening') {
      parts.push(
        'You followed opening principles well — developing pieces and controlling the center.',
      );
    } else if (phase === 'endgame') {
      parts.push(
        'Well played. In the endgame, precision matters and you found the right move.',
      );
    } else {
      parts.push('You identified the strongest continuation in this position.');
    }
    if (userScoreCp !== null) {
      if (userScoreCp > 300) {
        parts.push(
          'You have a winning advantage — stay focused and convert it safely.',
        );
      } else if (userScoreCp > 100) {
        parts.push(
          'You have a clear advantage. Keep pressing while avoiding unnecessary complications.',
        );
      } else if (userScoreCp > -50) {
        parts.push(
          'The position is roughly equal. Keep looking for small improvements.',
        );
      }
    }
    return parts.join(' ');
  }

  if (quality === 'excellent') {
    parts.push(
      `${userMoveSan} is nearly perfect — very close to the best move ${bestMoveSan} (eval ${bestEvalStr}).`,
    );
    parts.push(`The difference of ${lossStr} pawns is minimal.`);
  } else if (quality === 'good') {
    parts.push(
      `${userMoveSan} is solid but ${bestMoveSan} was stronger (eval ${bestEvalStr} vs your ${userEvalStr}).`,
    );
  } else if (quality === 'inaccuracy') {
    parts.push(
      `${userMoveSan} is an inaccuracy, losing about ${lossStr} pawns of advantage.`,
    );
    parts.push(`The best move was ${bestMoveSan} (eval ${bestEvalStr}).`);
  } else if (quality === 'mistake') {
    parts.push(`${userMoveSan} is a mistake, costing about ${lossStr} pawns.`);
    parts.push(`${bestMoveSan} was much better (eval ${bestEvalStr}).`);
  } else if (quality === 'blunder') {
    parts.push(
      `${userMoveSan} is a serious blunder! You lost ${lossStr} pawns of advantage.`,
    );
    parts.push(`${bestMoveSan} was the move to find (eval ${bestEvalStr}).`);
  }

  if (quality !== 'excellent') {
    if (bestMateIn !== null && bestMateIn > 0) {
      parts.push(
        `You missed a forced checkmate in ${bestMateIn}. Look for all checks and captures — forcing moves come first!`,
      );
    } else if (bestIsCheck && !userIsCheck) {
      parts.push(
        "The best move gives check, which is a forcing move. Always consider checks first — they limit your opponent's responses.",
      );
    } else if (bestIsCapture && !userIsCapture) {
      parts.push(
        'The best move captures material. Before making a quiet move, ask yourself: are there any captures available that improve my position?',
      );
    } else if (bestIsCastle) {
      parts.push(
        'The best move was castling. In this position, king safety was more important than the move you played.',
      );
    } else if (!bestIsCapture && !bestIsCheck) {
      const bestPieceName =
        pieceNames[bestPieceChar] ||
        (bestPieceChar === bestPieceChar.toLowerCase() ? 'pawn' : 'piece');
      parts.push(
        `The best move improves the ${bestPieceName}'s position. Sometimes the strongest moves aren't captures — they prepare future threats.`,
      );
    }
  }

  if (quality === 'mistake' || quality === 'blunder') {
    if (userIsCapture && !bestIsCapture) {
      parts.push(
        "Grabbing material isn't always best — sometimes your opponent left that piece hanging to lure you into a worse position. Think about what your opponent's plan is.",
      );
    } else if (!userIsCapture && !userIsCheck) {
      parts.push(
        'Before committing to a quiet move, use this checklist: (1) Are my pieces safe? (2) Does my opponent have threats? (3) Are there any tactics I can use?',
      );
    }
    if (phase === 'endgame') {
      parts.push(
        'In the endgame, every move counts. Think about pawn promotion, king activity, and piece coordination.',
      );
    }
  }

  if (quality === 'inaccuracy') {
    if (phase === 'opening') {
      parts.push(
        'In the opening, focus on: center control, piece development, king safety. Ask — does my move help any of these?',
      );
    } else {
      parts.push(
        'Ask yourself before each move: what is my opponent threatening, and what does my move accomplish?',
      );
    }
  }

  return parts.join(' ');
}

// ── Hook return type ─────────────────────────────────────────────────────────

export interface ChessEngineAPI {
  isReady: boolean;
  statusUpdate: StatusUpdate;
  getHint: (fen: string) => Promise<HintResult | { error: string }>;
  evaluateMove: (
    fen: string,
    moveUci: string,
    moveSan: string,
  ) => Promise<MoveEvaluation | { error: string }>;
  getBotMove: (
    fen: string,
    difficulty: BotDifficulty,
  ) => Promise<BotMoveResult | { error: string }>;
  analyzePosition: (fen: string) => Promise<PositionAnalysis>;
}

// ── The hook ─────────────────────────────────────────────────────────────────

export function useChessEngine(): ChessEngineAPI {
  const engineRef = useRef<StockfishWorker | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [statusUpdate, setStatusUpdate] = useState<StatusUpdate>({
    status: 'idle',
    message: 'Play a move or ask for a hint',
  });

  const sendStatus = useCallback(
    (status: StatusUpdate['status'], message: string) => {
      setStatusUpdate({ status, message });
    },
    [],
  );

  // Initialize engine once on mount
  useEffect(() => {
    const engine = new StockfishWorker();
    engineRef.current = engine;

    sendStatus('analyzing', 'Loading chess engine…');

    engine
      .initialize()
      .then(() => {
        setIsReady(true);
        sendStatus('idle', 'Play a move or ask for a hint');
      })
      .catch((err) => {
        console.error('[useChessEngine] Failed to initialize Stockfish:', err);
        sendStatus('error', 'Failed to load chess engine');
      });

    return () => {
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, [sendStatus]);

  // ── getHint ────────────────────────────────────────────────────────────────

  const getHint = useCallback(
    async (fen: string): Promise<HintResult | { error: string }> => {
      const engine = engineRef.current;
      if (!engine || !engine.isReady()) return { error: 'Engine not ready' };

      sendStatus('analyzing', 'Thinking about a hint…');
      try {
        const moves = await engine.analyze(
          fen,
          ANALYSIS_DEPTH,
          Math.max(MULTI_PV, 3),
        );
        if (moves.length === 0) {
          sendStatus('done', 'No moves available');
          return { error: 'No legal moves in this position' };
        }
        const coachingHint = generateCoachingHint(moves[0], fen, moves);
        sendStatus('done', 'Hint ready');
        return { bestMove: moves[0], fen, coachingHint };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendStatus('error', 'Hint failed');
        return { error: msg };
      }
    },
    [sendStatus],
  );

  // ── evaluateMove ───────────────────────────────────────────────────────────

  const evaluateMove = useCallback(
    async (
      fen: string,
      moveUci: string,
      moveSan: string,
    ): Promise<MoveEvaluation | { error: string }> => {
      const engine = engineRef.current;
      if (!engine || !engine.isReady()) return { error: 'Engine not ready' };

      sendStatus('analyzing', 'Evaluating your move…');
      try {
        const multiPV = Math.max(MULTI_PV, 8);
        const moves = await engine.analyze(fen, ANALYSIS_DEPTH, multiPV);
        if (moves.length === 0) {
          sendStatus('done', 'No moves to evaluate');
          return { error: 'No legal moves in this position' };
        }

        const bestMove = moves[0];
        const userMove = moves.find((m) => m.uci === moveUci);

        let userScoreCp = userMove?.scoreCp ?? null;
        let userMateIn = userMove?.mateIn ?? null;

        if (!userMove) {
          const worst = moves[moves.length - 1];
          userScoreCp = (worst.scoreCp ?? 0) - 50;
          userMateIn = null;
        }

        let centipawnLoss = 0;
        if (bestMove.mateIn !== null && bestMove.mateIn > 0) {
          if (userMateIn !== null && userMateIn > 0) {
            centipawnLoss = Math.max(0, (userMateIn - bestMove.mateIn) * 5);
          } else {
            centipawnLoss = 300;
          }
        } else if (bestMove.scoreCp !== null && userScoreCp !== null) {
          centipawnLoss = Math.max(0, bestMove.scoreCp - userScoreCp);
        }

        const quality = classifyMoveQuality(centipawnLoss);
        const explanation = buildExplanation(
          quality,
          moveSan,
          bestMove.san || bestMove.uci,
          centipawnLoss,
          bestMove.scoreCp,
          bestMove.mateIn,
          userScoreCp,
          userMateIn,
          fen,
          moveUci,
          bestMove.uci,
        );

        sendStatus('done', `Move evaluated: ${quality}`);
        return {
          userMoveSan: moveSan,
          userMoveUci: moveUci,
          userMoveScoreCp: userScoreCp,
          userMoveMateIn: userMateIn,
          bestMoveSan: bestMove.san || bestMove.uci,
          bestMoveUci: bestMove.uci,
          bestMoveScoreCp: bestMove.scoreCp,
          bestMoveMateIn: bestMove.mateIn,
          quality,
          explanation,
          centipawnLoss,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendStatus('error', 'Evaluation failed');
        return { error: msg };
      }
    },
    [sendStatus],
  );

  // ── getBotMove ─────────────────────────────────────────────────────────────

  const getBotMove = useCallback(
    async (
      fen: string,
      difficulty: BotDifficulty,
    ): Promise<BotMoveResult | { error: string }> => {
      const engine = engineRef.current;
      if (!engine || !engine.isReady()) return { error: 'Engine not ready' };

      const config =
        BOT_DIFFICULTY_CONFIG[difficulty] || BOT_DIFFICULTY_CONFIG[3];
      sendStatus('analyzing', 'Opponent is thinking…');

      try {
        const moves = await engine.analyze(fen, config.depth, config.multiPV);
        if (moves.length === 0) {
          sendStatus('done', 'No legal moves');
          return { error: 'No legal moves for the bot' };
        }

        let chosenMove: EngineMove;
        if (Math.random() < config.blunderChance && moves.length > 2) {
          const worstHalf = moves.slice(Math.floor(moves.length / 2));
          chosenMove = worstHalf[Math.floor(Math.random() * worstHalf.length)];
        } else {
          const topN = moves.slice(
            0,
            Math.min(config.pickFromTopN, moves.length),
          );
          const weights = topN.map((_, i) => Math.pow(0.5, i));
          const totalWeight = weights.reduce((a, b) => a + b, 0);
          let rand = Math.random() * totalWeight;
          let idx = 0;
          for (let i = 0; i < weights.length; i++) {
            rand -= weights[i];
            if (rand <= 0) {
              idx = i;
              break;
            }
          }
          chosenMove = topN[idx];
        }

        const game = new Chess(fen);
        const result = game.move({
          from: chosenMove.uci.slice(0, 2),
          to: chosenMove.uci.slice(2, 4),
          promotion: chosenMove.uci[4] || undefined,
        });

        if (!result) {
          sendStatus('error', 'Bot move invalid');
          return { error: 'Bot generated an invalid move' };
        }

        sendStatus('done', `Opponent played ${result.san}`);
        return {
          moveUci: chosenMove.uci,
          moveSan: result.san,
          fen: game.fen(),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendStatus('error', 'Bot move failed');
        return { error: msg };
      }
    },
    [sendStatus],
  );

  // ── analyzePosition ────────────────────────────────────────────────────────

  const analyzePosition = useCallback(
    async (fen: string): Promise<PositionAnalysis> => {
      const engine = engineRef.current;
      if (!engine || !engine.isReady()) {
        return { fen, moves: [], error: 'Engine not ready' };
      }

      sendStatus('analyzing', 'Analyzing position…');
      try {
        const multiPV = Math.max(MULTI_PV, 5);
        const moves = await engine.analyze(fen, ANALYSIS_DEPTH, multiPV);
        if (moves.length === 0) {
          sendStatus('done', 'No legal moves');
          return { fen, moves: [], error: 'No legal moves in this position' };
        }

        const analyzedMoves: AnalyzedMove[] = moves.map((m) => ({
          ...m,
          description: describeMoveForModeler(m, fen),
        }));

        sendStatus('done', `Found ${analyzedMoves.length} moves`);
        return { fen, moves: analyzedMoves };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sendStatus('error', 'Analysis failed');
        return { fen, moves: [], error: msg };
      }
    },
    [sendStatus],
  );

  return {
    isReady,
    statusUpdate,
    getHint,
    evaluateMove,
    getBotMove,
    analyzePosition,
  };
}
