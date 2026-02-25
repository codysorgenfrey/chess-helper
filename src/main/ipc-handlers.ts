import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '../shared/constants';
import {
  AnalysisResult,
  AppSettings,
  CalibrationConfirmRegionPayload,
  DetectedBoard,
} from '../shared/types';
import { EngineManager } from './engine/engine-manager';
import { captureScreen } from './capture/screenshot';
import { detectChessBoard } from './vision/board-detector';
import { classifyPieces } from './vision/piece-classifier';
import { buildFEN, validateFEN } from './vision/fen-builder';
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
import { getGameTracker, resetGameTracker } from './vision/game-tracker';

function sendStatus(win: BrowserWindow, status: string, message: string): void {
  win.webContents.send(IPC.STATUS_UPDATE, { status, message });
}

export function registerIpcHandlers(
  win: BrowserWindow,
  engine: EngineManager,
): void {
  // Handle internal trigger (from global hotkey)
  ipcMain.on('trigger-capture-internal', () => {
    runCapturePipeline(win, engine);
  });

  // Handle renderer-invoked capture
  ipcMain.handle(IPC.TRIGGER_CAPTURE, async () => {
    return runCapturePipeline(win, engine);
  });

  // Manual FEN input
  ipcMain.handle(IPC.SET_FEN_MANUAL, async (_event, fen: string) => {
    return runAnalysis(win, engine, fen, null, 1.0);
  });

  // Settings
  ipcMain.handle(IPC.GET_SETTINGS, () => {
    return getSettings();
  });

  ipcMain.handle(IPC.SAVE_SETTINGS, (_event, partial: Partial<AppSettings>) => {
    const updated = saveSettings(partial);
    win.webContents.send(IPC.SETTINGS_CHANGED, updated);
    return updated;
  });

  // Toggle side to move
  ipcMain.handle(IPC.TOGGLE_SIDE, (_event, side: 'w' | 'b') => {
    return saveSettings({ sideToMove: side });
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
const NORMAL_HEIGHT = 620;

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
  win.setMinimumSize(NORMAL_WIDTH, NORMAL_HEIGHT);
  win.setMaximumSize(NORMAL_WIDTH, NORMAL_HEIGHT);
  win.setResizable(false);
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

async function runCapturePipeline(
  win: BrowserWindow,
  engine: EngineManager,
): Promise<AnalysisResult> {
  const settings = getSettings();

  try {
    // Step 1: Capture screen
    sendStatus(win, 'capturing', 'Capturing screen…');
    const screenshot = await captureScreen();

    // Step 2: Determine board location
    sendStatus(win, 'detecting', 'Detecting chess board…');
    let board: DetectedBoard | null = null;
    const cal = getCalibration();

    if (cal) {
      // Use the calibrated board rectangle directly — much more reliable
      // than the heuristic board detector.
      const r = cal.boardRect;
      board = {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        squareSize: Math.round(r.width / 8),
        isFlipped: cal.isFlipped,
        confidence: 1.0,
      };
      console.log(
        `[Pipeline] Using calibrated board rect: x=${r.x} y=${r.y} w=${r.width} h=${r.height} flipped=${cal.isFlipped}`,
      );
    } else {
      // No calibration — fall back to heuristic board detection
      board = await detectChessBoard(screenshot.buffer);
    }

    if (!board) {
      const result: AnalysisResult = {
        fen: '',
        moves: [],
        detectedBoard: null,
        boardGridConfidence: 0,
        timestamp: Date.now(),
        error: 'No chess board detected. Try manual FEN input.',
      };
      win.webContents.send(IPC.ANALYSIS_UPDATE, result);
      sendStatus(win, 'error', 'No board detected');
      return result;
    }

    // Step 3: Classify the board visually then match to legal moves
    sendStatus(win, 'classifying', 'Classifying board…');
    const { grid, confidence: classifierConfidence } = await classifyPieces(
      screenshot.buffer,
      board,
    );

    console.log(
      `[Pipeline] Classifier confidence: ${(classifierConfidence * 100).toFixed(1)}%`,
    );

    // Step 4: Use game tracker to match classified grid to legal moves
    sendStatus(win, 'classifying', 'Matching position to game state…');
    const tracker = getGameTracker();
    const trackResult = tracker.processClassifiedGrid(grid);

    if (trackResult) {
      const { fen, confidence, movesApplied } = trackResult;
      if (movesApplied.length > 0) {
        console.log(
          `[Pipeline] Tracked moves: ${movesApplied.join(', ')} → FEN: ${fen}`,
        );
      } else {
        console.log(`[Pipeline] No moves detected. FEN: ${fen}`);
      }

      return runAnalysis(win, engine, fen, board, confidence);
    }

    // Tracker couldn't find a good legal continuation — fall back to raw FEN
    console.warn(
      '[Pipeline] Game tracker could not match — building FEN from classifier',
    );
    sendStatus(win, 'analyzing', 'Building position…');
    const fen = buildFEN(grid, settings.sideToMove, settings.castlingRights);

    if (!fen) {
      const result: AnalysisResult = {
        fen: '',
        moves: [],
        detectedBoard: board,
        boardGridConfidence: classifierConfidence,
        timestamp: Date.now(),
        error: 'Could not determine position. Try manual FEN input.',
      };
      win.webContents.send(IPC.ANALYSIS_UPDATE, result);
      sendStatus(win, 'error', 'Invalid position detected');
      return result;
    }

    return runAnalysis(win, engine, fen, board, classifierConfidence);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const result: AnalysisResult = {
      fen: '',
      moves: [],
      detectedBoard: null,
      boardGridConfidence: 0,
      timestamp: Date.now(),
      error: errorMsg,
    };
    win.webContents.send(IPC.ANALYSIS_UPDATE, result);
    sendStatus(win, 'error', errorMsg.split('\n')[0]);
    return result;
  }
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
