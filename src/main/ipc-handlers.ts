import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '../shared/constants';
import {
  AnalysisResult,
  AppSettings,
  BotDifficulty,
  CalibrationConfirmRegionPayload,
  DetectedBoard,
  HintResult,
  MoveEvaluation,
  MoveQuality,
  AnalyzedMove,
  PositionAnalysis,
} from '../shared/types';
import { EngineManager } from './engine/engine-manager';
import { validateFEN } from './vision/fen-builder';
import {
  captureScreenForCalibration,
  confirmBoardRegion,
  buildCalibrationData,
  cancelCalibration,
  getBoardDimensions,
} from './vision/calibration-capture';
import {
  getSettings,
  saveSettings,
  getCalibration,
  saveCalibration,
} from './store';
import { resetGameTracker } from './vision/game-tracker';

function sendStatus(win: BrowserWindow, status: string, message: string): void {
  win.webContents.send(IPC.STATUS_UPDATE, { status, message });
}

export function registerIpcHandlers(
  win: BrowserWindow,
  engine: EngineManager,
): void {
  // Manual FEN input
  ipcMain.handle(IPC.SET_FEN_MANUAL, async (_event, fen: string) => {
    return runAnalysis(win, engine, fen, null, 1.0);
  });

  // Get hint: analyze position and return best move
  ipcMain.handle(IPC.GET_HINT, async (_event, fen: string) => {
    return getHint(win, engine, fen);
  });

  // Evaluate a user's move: compare it to the engine's best
  ipcMain.handle(
    IPC.EVALUATE_MOVE,
    async (
      _event,
      payload: { fen: string; moveUci: string; moveSan: string },
    ) => {
      return evaluateMove(
        win,
        engine,
        payload.fen,
        payload.moveUci,
        payload.moveSan,
      );
    },
  );

  // Get a bot move at a given difficulty level (1-5)
  ipcMain.handle(
    IPC.GET_BOT_MOVE,
    async (_event, payload: { fen: string; difficulty: BotDifficulty }) => {
      return getBotMove(win, engine, payload.fen, payload.difficulty);
    },
  );

  // Analyze a position and return all top moves with descriptions (modeler mode)
  ipcMain.handle(
    IPC.ANALYZE_POSITION,
    async (_event, payload: { fen: string }) => {
      return analyzePosition(win, engine, payload.fen);
    },
  );

  // Settings
  ipcMain.handle(IPC.GET_SETTINGS, () => {
    return getSettings();
  });

  ipcMain.handle(IPC.SAVE_SETTINGS, (_event, partial: Partial<AppSettings>) => {
    const updated = saveSettings(partial);
    win.webContents.send(IPC.SETTINGS_CHANGED, updated);
    return updated;
  });

  // Get persisted calibration data (renderer checks on startup)
  ipcMain.handle(IPC.GET_CALIBRATION, () => {
    return getCalibration();
  });

  // ── Calibration wizard handlers ─────────────────────────────────────────────
  registerCalibrationHandlers(win);
}

// Normal overlay dimensions
const NORMAL_WIDTH = 320;
const NORMAL_HEIGHT = 700;

// UI chrome height reserved above/below the board image
// (header + progress bar + step counter + step group + instruction + swatches + cancel button + gaps)
const WIZARD_CHROME_HEIGHT = 180;

// Chrome height for the selection phase (header + instruction + confirm/cancel buttons)
const WIZARD_SELECT_CHROME_HEIGHT = 100;

function resizeForScreenshot(
  win: BrowserWindow,
  screenshotW: number,
  screenshotH: number,
): void {
  const winW = screenshotW;
  const winH = screenshotH + WIZARD_SELECT_CHROME_HEIGHT;
  console.log(
    `[Calibration] Resize for selection → screenshot: ${screenshotW}×${screenshotH}, window: ${winW}×${winH}`,
  );
  win.setResizable(true);
  win.setMinimumSize(1, 1);
  win.setMaximumSize(9999, 9999);
  win.setContentSize(winW, winH, true);
  win.setMinimumSize(winW, winH);
  win.setMaximumSize(winW, winH);
  win.setResizable(false);
}

function resizeForCalibration(win: BrowserWindow): void {
  const { width, height } = getBoardDimensions(); // exact preview image pixels
  const winW = width;
  const winH = height + WIZARD_CHROME_HEIGHT;
  console.log(
    `[Calibration] Resize → preview: ${width}×${height}, window: ${winW}×${winH}`,
  );
  win.setResizable(true);
  win.setMinimumSize(1, 1);
  win.setMaximumSize(9999, 9999);
  win.setContentSize(winW, winH, true /* animate */);
  win.setMinimumSize(winW, winH);
  win.setMaximumSize(winW, winH);
  win.setResizable(false);
}

function restoreNormalSize(win: BrowserWindow): void {
  win.setResizable(true);
  win.setMinimumSize(1, 1);
  win.setMaximumSize(9999, 9999);
  win.setContentSize(NORMAL_WIDTH, NORMAL_HEIGHT, true);
  win.setMinimumSize(NORMAL_WIDTH, 500);
  win.setMaximumSize(NORMAL_WIDTH, 1200);
  win.setResizable(true);
}

function registerCalibrationHandlers(win: BrowserWindow): void {
  // Step 1: capture screenshot and send to renderer for manual board selection
  ipcMain.handle(IPC.CALIBRATION_START, async () => {
    try {
      const payload = await captureScreenForCalibration();
      // Resize window to show the full screenshot
      resizeForScreenshot(
        win,
        payload.screenshotWidthPx,
        payload.screenshotHeightPx,
      );
      win.webContents.send(IPC.CALIBRATION_SCREENSHOT, payload);
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      win.webContents.send(IPC.CALIBRATION_ERROR, { message });
      return { success: false, error: message };
    }
  });

  // Step 2: user drew a rectangle around the board — crop & prepare board preview
  ipcMain.handle(
    IPC.CALIBRATION_CONFIRM_REGION,
    async (_event, payload: CalibrationConfirmRegionPayload) => {
      try {
        const initPayload = await confirmBoardRegion(payload);
        resizeForCalibration(win);
        win.webContents.send(IPC.CALIBRATION_INIT, initPayload);
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        win.webContents.send(IPC.CALIBRATION_ERROR, { message });
        return { success: false, error: message };
      }
    },
  );

  // Step 3: extract templates from starting position and persist
  ipcMain.handle(IPC.CALIBRATION_SAVE, async (_event, isFlipped: boolean) => {
    try {
      const data = await buildCalibrationData(isFlipped);
      saveCalibration(data);

      // Reset the game tracker — a new calibration means a fresh game
      resetGameTracker();

      restoreNormalSize(win);
      win.webContents.send(IPC.CALIBRATION_COMPLETE, data);
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      win.webContents.send(IPC.CALIBRATION_ERROR, { message });
      return { success: false, error: message };
    }
  });

  // Cancel / discard in-progress calibration
  ipcMain.handle(IPC.CALIBRATION_CANCEL, () => {
    cancelCalibration();
    restoreNormalSize(win);
    return { success: true };
  });
}


async function runAnalysis(
  win: BrowserWindow,
  engine: EngineManager,
  fen: string,
  board: DetectedBoard | null,
  gridConfidence: number,
): Promise<AnalysisResult> {
  const settings = getSettings();

  // Validate FEN
  const fenValidation = validateFEN(fen);
  if (!fenValidation.valid) {
    const result: AnalysisResult = {
      fen,
      moves: [],
      detectedBoard: null,
      boardGridConfidence: gridConfidence,
      timestamp: Date.now(),
      error: `Invalid FEN: ${fenValidation.error}`,
    };
    win.webContents.send(IPC.ANALYSIS_UPDATE, result);
    sendStatus(win, 'error', 'Invalid FEN');
    return result;
  }

  if (!engine.isReady()) {
    const result: AnalysisResult = {
      fen,
      moves: [],
      detectedBoard: null,
      boardGridConfidence: gridConfidence,
      timestamp: Date.now(),
      error: 'Chess engine not ready. Please ensure Stockfish is installed.',
    };
    win.webContents.send(IPC.ANALYSIS_UPDATE, result);
    sendStatus(win, 'error', 'Engine not ready');
    return result;
  }

  sendStatus(
    win,
    'analyzing',
    `Analyzing position (depth ${settings.analysisDepth})…`,
  );

  try {
    const moves = await engine.analyze(
      fen,
      settings.analysisDepth,
      settings.multiPV,
    );

    const result: AnalysisResult = {
      fen,
      moves,
      detectedBoard: board,
      boardGridConfidence: gridConfidence,
      timestamp: Date.now(),
    };

    win.webContents.send(IPC.ANALYSIS_UPDATE, result);
    sendStatus(win, 'done', `Found ${moves.length} moves`);
    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const result: AnalysisResult = {
      fen,
      moves: [],
      detectedBoard: board,
      boardGridConfidence: gridConfidence,
      timestamp: Date.now(),
      error: `Analysis failed: ${errorMsg}`,
    };
    win.webContents.send(IPC.ANALYSIS_UPDATE, result);
    sendStatus(win, 'error', 'Analysis failed');
    return result;
  }
}

// ── Hint ────────────────────────────────────────────────────────────────────

import { Chess } from 'chess.js';

/**
 * Detect tactical and strategic themes in a position/move for richer explanations.
 */
function detectThemes(
  fen: string,
  move: import('../shared/types').EngineMove,
): string[] {
  const themes: string[] = [];
  const san = move.san || '';
  const uci = move.uci || '';
  const pv = move.pv || [];

  try {
    const game = new Chess(fen);
    const sideToMove = game.turn(); // 'w' or 'b'
    const opponentColor = sideToMove === 'w' ? 'b' : 'w';

    // Check if in check before the move
    if (game.isCheck()) {
      themes.push('You need to get out of check first');
    }

    // Parse move characteristics
    const isCapture = san.includes('x');
    const isCheck = san.includes('+');
    const isMate = san.includes('#');
    const isCastle = san === 'O-O' || san === 'O-O-O';

    // Try to make the move to analyze resulting position
    const moveResult = game.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4] || undefined,
    });
    if (!moveResult) return themes;

    // Material themes
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
        themes.push(`This wins material — you capture a more valuable piece`);
      } else if (capturedValue === movingPieceValue) {
        themes.push(`This is an even trade`);
      }
    }

    // Fork detection — after the move, does the piece attack multiple high-value targets?
    if (!isCastle) {
      const targetSquare = uci.slice(2, 4);
      // Check if the moved piece attacks multiple opponent pieces
      const attacks = game
        .moves({ verbose: true })
        .filter((m) => m.from === targetSquare && m.captured);
      // Not perfect (this checks the opponent's reply moves), but the concept helps

      // Instead, look at the PV for patterns
      if (pv.length >= 2) {
        // If the PV shows we capture on the next move too, it may be a tactic
        const nextMoveStr = pv[1];
        if (nextMoveStr && nextMoveStr.length >= 4) {
          // Check if our next PV move is also from the same square (potential discovered attack)
        }
      }
    }

    // King safety themes
    if (isCastle) {
      themes.push('Castling improves king safety and connects your rooks');
    }

    if (isCheck) {
      themes.push('This gives check, forcing your opponent to respond');
    }

    if (isMate) {
      themes.push('This is checkmate!');
    }

    // Pawn structure themes
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

    // Development themes (opening)
    const moveNumber = parseInt(fen.split(' ')[5] || '1');
    if (moveNumber <= 10) {
      if (moveResult.piece === 'n' || moveResult.piece === 'b') {
        themes.push(
          'Developing a minor piece toward the center is good opening play',
        );
      }
    }

    // Piece activity
    if (moveResult.piece === 'r') {
      const targetFile = uci[2];
      // Open file detection is complex; hint at it
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

    // Evaluate the PV for deeper insight
    if (pv.length >= 3) {
      themes.push(`The engine sees a plan extending ${pv.length} moves deep`);
    }

    // Undo to restore position
    game.undo();
  } catch {
    // If analysis fails, just return what we have
  }

  return themes;
}

/**
 * Generate a rich coaching-style hint from the best engine move.
 * Focuses on WHY — tactical/strategic reasoning rather than just WHERE.
 */
function generateCoachingHint(
  move: import('../shared/types').EngineMove,
  fen: string,
  allMoves: import('../shared/types').EngineMove[],
): string {
  const san = move.san || '';
  const uci = move.uci || '';
  const scoreCp = move.scoreCp ?? 0;

  // Parse the side to move from FEN
  const sideLabel = fen.split(' ')[1] === 'w' ? 'White' : 'Black';

  // Detect move characteristics
  const isCapture = san.includes('x');
  const isCheck = san.includes('+');
  const isMate =
    san.includes('#') ||
    (move.mateIn !== null && move.mateIn > 0 && move.mateIn <= 5);
  const isCastle = san === 'O-O' || san === 'O-O-O';
  const isPromotion = san.includes('=');

  // Determine piece type
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

  // Area hints
  const targetSquare = uci.slice(2, 4);
  const targetFile = targetSquare[0];
  const fileZone = 'abc'.includes(targetFile)
    ? 'queenside'
    : 'fgh'.includes(targetFile)
      ? 'kingside'
      : 'center';

  // Detect themes for richer context
  const themes = detectThemes(fen, move);

  // Get the eval gap between first and second move for urgency
  const secondBestCp =
    allMoves.length > 1 ? (allMoves[1].scoreCp ?? 0) : scoreCp;
  const evalGap = scoreCp - secondBestCp;
  const isOnly = evalGap > 150; // This move is MUCH better than alternatives

  // Get move number context
  const moveNumber = parseInt(fen.split(' ')[5] || '1');
  const phase =
    moveNumber <= 10 ? 'opening' : moveNumber <= 25 ? 'middlegame' : 'endgame';

  // Build the hint
  const parts: string[] = [];

  // 1. Situational assessment
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

  // 2. Strategic context based on phase
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
    // Endgame
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

  // 3. Add the most relevant themes
  const relevantThemes = themes
    .filter(
      (t) => !t.includes('checkmate') || !isMate, // avoid redundancy
    )
    .slice(0, 2);

  if (relevantThemes.length > 0) {
    parts.push(relevantThemes.join('. ') + '.');
  }

  // 4. Thinking prompts
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

async function getHint(
  win: BrowserWindow,
  engine: EngineManager,
  fen: string,
): Promise<HintResult | { error: string }> {
  const settings = getSettings();

  if (!engine.isReady()) {
    return { error: 'Engine not ready' };
  }

  sendStatus(win, 'analyzing', 'Thinking about a hint…');

  try {
    // Analyze with multiple lines so we can assess the position
    const moves = await engine.analyze(
      fen,
      settings.analysisDepth,
      Math.max(settings.multiPV, 3),
    );
    if (moves.length === 0) {
      sendStatus(win, 'done', 'No moves available');
      return { error: 'No legal moves in this position' };
    }

    const coachingHint = generateCoachingHint(moves[0], fen, moves);

    sendStatus(win, 'done', 'Hint ready');
    return { bestMove: moves[0], fen, coachingHint };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendStatus(win, 'error', 'Hint failed');
    return { error: msg };
  }
}

// ── Position Analysis (Modeler mode) ────────────────────────────────────────

/**
 * Generate a brief human-readable description of what a move does.
 */
function describeMoveForModeler(
  move: import('../shared/types').EngineMove,
  fen: string,
): string {
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

  // Get themes for context
  const themes = detectThemes(fen, move);

  const parts: string[] = [];

  // Core description
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

  // Add the most relevant theme
  const relevantThemes = themes.filter(
    (t) =>
      !t.includes('checkmate') &&
      !t.includes('check') &&
      !t.includes('Castling'),
  );
  if (relevantThemes.length > 0) {
    parts.push(relevantThemes[0]);
  }

  // Add eval context
  if (move.mateIn === null) {
    const evalPawns = scoreCp / 100;
    if (evalPawns > 3) {
      parts.push('Winning position.');
    } else if (evalPawns > 1) {
      parts.push('Clear advantage.');
    } else if (evalPawns > 0.3) {
      parts.push('Slight edge.');
    } else if (evalPawns > -0.3) {
      parts.push('Equal position.');
    } else if (evalPawns > -1) {
      parts.push('Slightly worse.');
    } else if (evalPawns > -3) {
      parts.push('Disadvantage.');
    } else {
      parts.push('Losing position.');
    }
  }

  return parts.join(' ');
}

async function analyzePosition(
  win: BrowserWindow,
  engine: EngineManager,
  fen: string,
): Promise<PositionAnalysis> {
  const settings = getSettings();

  if (!engine.isReady()) {
    return { fen, moves: [], error: 'Engine not ready' };
  }

  sendStatus(win, 'analyzing', 'Analyzing position…');

  try {
    const multiPV = Math.max(settings.multiPV, 5);
    const moves = await engine.analyze(fen, settings.analysisDepth, multiPV);

    if (moves.length === 0) {
      sendStatus(win, 'done', 'No legal moves');
      return { fen, moves: [], error: 'No legal moves in this position' };
    }

    const analyzedMoves: AnalyzedMove[] = moves.map((m) => ({
      ...m,
      description: describeMoveForModeler(m, fen),
    }));

    sendStatus(win, 'done', `Found ${analyzedMoves.length} moves`);
    return { fen, moves: analyzedMoves };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendStatus(win, 'error', 'Analysis failed');
    return { fen, moves: [], error: msg };
  }
}

// ── Bot Move ────────────────────────────────────────────────────────────────

/**
 * Difficulty settings for the bot opponent (1-5 scale).
 * Lower = weaker play through shallower search + random move selection from top N.
 */
const BOT_DIFFICULTY_CONFIG: Record<
  1 | 2 | 3 | 4 | 5,
  {
    depth: number;
    multiPV: number;
    pickFromTopN: number;
    blunderChance: number;
  }
> = {
  1: { depth: 4, multiPV: 8, pickFromTopN: 8, blunderChance: 0.3 }, // Beginner: shallow, often picks bad moves
  2: { depth: 6, multiPV: 6, pickFromTopN: 5, blunderChance: 0.15 }, // Casual: some mistakes
  3: { depth: 10, multiPV: 4, pickFromTopN: 3, blunderChance: 0.05 }, // Intermediate: mostly good moves
  4: { depth: 14, multiPV: 3, pickFromTopN: 2, blunderChance: 0.02 }, // Advanced: strong play
  5: { depth: 18, multiPV: 1, pickFromTopN: 1, blunderChance: 0.0 }, // Master: best move always
};

async function getBotMove(
  win: BrowserWindow,
  engine: EngineManager,
  fen: string,
  difficulty: BotDifficulty,
): Promise<import('../shared/types').BotMoveResult | { error: string }> {
  if (!engine.isReady()) {
    return { error: 'Engine not ready' };
  }

  const config = BOT_DIFFICULTY_CONFIG[difficulty] || BOT_DIFFICULTY_CONFIG[3];

  sendStatus(win, 'analyzing', 'Opponent is thinking…');

  try {
    const moves = await engine.analyze(fen, config.depth, config.multiPV);
    if (moves.length === 0) {
      sendStatus(win, 'done', 'No legal moves');
      return { error: 'No legal moves for the bot' };
    }

    // Pick a move based on difficulty
    let chosenMove: import('../shared/types').EngineMove;

    if (Math.random() < config.blunderChance && moves.length > 2) {
      // Blunder: pick from the worst half of analyzed moves
      const worstHalf = moves.slice(Math.floor(moves.length / 2));
      chosenMove = worstHalf[Math.floor(Math.random() * worstHalf.length)];
    } else {
      // Pick from top N moves with weighted randomness
      const topN = moves.slice(0, Math.min(config.pickFromTopN, moves.length));
      // Weight toward the better moves: index 0 most likely
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

    // Apply the move to get the resulting FEN
    const game = new Chess(fen);
    const result = game.move({
      from: chosenMove.uci.slice(0, 2),
      to: chosenMove.uci.slice(2, 4),
      promotion: chosenMove.uci[4] || undefined,
    });

    if (!result) {
      sendStatus(win, 'error', 'Bot move invalid');
      return { error: 'Bot generated an invalid move' };
    }

    sendStatus(win, 'done', `Opponent played ${result.san}`);

    return {
      moveUci: chosenMove.uci,
      moveSan: result.san,
      fen: game.fen(),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendStatus(win, 'error', 'Bot move failed');
    return { error: msg };
  }
}

// ── Move Evaluation ─────────────────────────────────────────────────────────

function classifyMoveQuality(centipawnLoss: number): MoveQuality {
  if (centipawnLoss <= 0) return 'best';
  if (centipawnLoss <= 10) return 'excellent';
  if (centipawnLoss <= 30) return 'good';
  if (centipawnLoss <= 80) return 'inaccuracy';
  if (centipawnLoss <= 200) return 'mistake';
  return 'blunder';
}

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
  userMoveUci: string,
  bestMoveUci: string,
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

  // Detect what the user's move and the best move do
  const userPieceChar = userMoveSan[0];
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

  // Get game phase
  const moveNumber = parseInt(fen.split(' ')[5] || '1');
  const phase =
    moveNumber <= 10 ? 'opening' : moveNumber <= 25 ? 'middlegame' : 'endgame';

  if (quality === 'best') {
    parts.push(`Excellent! ${userMoveSan} is the engine's top choice.`);

    // Explain WHY it was the best
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

    // What should they be thinking about going forward
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

  // Non-best moves — explain what happened
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

  // Now explain WHY the best move was better
  if (quality !== 'excellent') {
    if (bestMateIn !== null && bestMateIn > 0) {
      parts.push(
        `You missed a forced checkmate in ${bestMateIn}. Look for all checks and captures — forcing moves come first!`,
      );
    } else if (bestIsCheck && !userIsCheck) {
      parts.push(
        `The best move gives check, which is a forcing move. Always consider checks first — they limit your opponent's responses.`,
      );
    } else if (bestIsCapture && !userIsCapture) {
      parts.push(
        `The best move captures material. Before making a quiet move, ask yourself: are there any captures available that improve my position?`,
      );
    } else if (bestIsCastle) {
      parts.push(
        `The best move was castling. In this position, king safety was more important than the move you played.`,
      );
    } else if (!bestIsCapture && !bestIsCheck) {
      // The best move was a quiet positional move
      const bestPieceName =
        pieceNames[bestPieceChar] ||
        (bestPieceChar === bestPieceChar.toLowerCase() ? 'pawn' : 'piece');
      parts.push(
        `The best move improves the ${bestPieceName}'s position. Sometimes the strongest moves aren't captures — they prepare future threats.`,
      );
    }
  }

  // Teaching moment based on what the user did wrong
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

    // Endgame-specific advice
    if (phase === 'endgame') {
      parts.push(
        'In the endgame, every move counts. Think about pawn promotion, king activity, and piece coordination.',
      );
    }
  }

  // General thinking advice
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

async function evaluateMove(
  win: BrowserWindow,
  engine: EngineManager,
  fen: string,
  moveUci: string,
  moveSan: string,
): Promise<MoveEvaluation | { error: string }> {
  const settings = getSettings();

  if (!engine.isReady()) {
    return { error: 'Engine not ready' };
  }

  sendStatus(win, 'analyzing', 'Evaluating your move…');

  try {
    // Analyze with enough lines to likely include the user's move
    const multiPV = Math.max(settings.multiPV, 8);
    const moves = await engine.analyze(fen, settings.analysisDepth, multiPV);

    if (moves.length === 0) {
      sendStatus(win, 'done', 'No moves to evaluate');
      return { error: 'No legal moves in this position' };
    }

    const bestMove = moves[0];

    // Find the user's move in the results
    const userMove = moves.find((m) => m.uci === moveUci);

    let userScoreCp = userMove?.scoreCp ?? null;
    let userMateIn = userMove?.mateIn ?? null;

    // If the user's move wasn't in top N, it's worse than all of them
    // Use the worst returned move's eval as an upper bound, then add a penalty
    if (!userMove) {
      const worst = moves[moves.length - 1];
      userScoreCp = (worst.scoreCp ?? 0) - 50; // conservative penalty
      userMateIn = null;
    }

    // Compute centipawn loss
    let centipawnLoss = 0;
    if (bestMove.mateIn !== null && bestMove.mateIn > 0) {
      // Best move is a forced win
      if (userMateIn !== null && userMateIn > 0) {
        // User also found a mate, small difference based on length
        centipawnLoss = Math.max(0, (userMateIn - bestMove.mateIn) * 5);
      } else {
        // User missed a mate
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

    sendStatus(win, 'done', `Move evaluated: ${quality}`);

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
    sendStatus(win, 'error', 'Evaluation failed');
    return { error: msg };
  }
}
