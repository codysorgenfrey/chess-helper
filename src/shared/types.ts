// Piece types: uppercase = white, lowercase = black, null = empty
export type PieceSymbol =
  | 'P'
  | 'N'
  | 'B'
  | 'R'
  | 'Q'
  | 'K'
  | 'p'
  | 'n'
  | 'b'
  | 'r'
  | 'q'
  | 'k';
export type SquareContent = PieceSymbol | null;

// 8x8 board grid: grid[rank][file], rank 0 = rank 8 (top), rank 7 = rank 1 (bottom)
export type BoardGrid = SquareContent[][];

export interface DetectedBoard {
  x: number; // Top-left x on screenshot
  y: number; // Top-left y on screenshot
  width: number; // Board pixel width
  height: number; // Board pixel height
  squareSize: number;
  isFlipped: boolean; // true = black's perspective (a1 is top-right)
  confidence: number; // 0–1
}

export interface EngineMove {
  rank: number; // 1 = best
  uci: string; // e.g. "e2e4"
  san: string; // e.g. "e4"
  scoreCp: number | null; // centipawns (positive = good for side to move)
  mateIn: number | null; // null if not mate
  depth: number;
  pv: string[]; // Principal variation (UCI moves)
}

export interface AnalysisResult {
  fen: string;
  moves: EngineMove[];
  detectedBoard: DetectedBoard | null;
  boardGridConfidence: number; // 0–1 confidence in piece classification
  timestamp: number;
  error?: string;
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

export interface AppSettings {
  captureHotkey: string; // e.g. "CommandOrControl+Shift+C"
  sideToMove: 'w' | 'b';
  analysisDepth: number; // default 18
  multiPV: number; // default 5
  stockfishPath: string; // path to stockfish binary
  windowOpacity: number; // 0.6–1.0
  windowX: number | null;
  windowY: number | null;
  castlingRights: string; // e.g. "KQkq"
}

export const DEFAULT_SETTINGS: AppSettings = {
  captureHotkey: 'CommandOrControl+Shift+C',
  sideToMove: 'w',
  analysisDepth: 18,
  multiPV: 5,
  stockfishPath: '',
  windowOpacity: 0.92,
  windowX: null,
  windowY: null,
  castlingRights: 'KQkq',
};

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

// ── Calibration types ──────────────────────────────────────────────────────────

/**
 * A single square template captured from a known board position (starting position).
 * Stores the raw RGB pixel data (base64-encoded) of the cropped, resized square.
 */
export interface SquareTemplate {
  piece: PieceSymbol | null; // null = empty square
  isLightSquare: boolean; // true if the square background is light
  imageBase64: string; // base64 of raw RGB bytes (TEMPLATE_SIZE² × 3)
}

/**
 * Calibration data: auto-extracted square templates from the starting position.
 * Replaces the old per-piece-click approach with full-image template matching.
 */
export interface CalibrationData {
  templates: SquareTemplate[];
  boardRect: { x: number; y: number; width: number; height: number };
  isFlipped: boolean; // true = black was at bottom during calibration
  capturedAt: number; // Date.now()
}

/** Sent from main → renderer with the full screenshot for manual board selection. */
export interface CalibrationScreenshotPayload {
  screenshotDataUrl: string; // data:image/png;base64,… (full screenshot, scaled to fit)
  screenshotWidthPx: number; // pixel width of the preview image
  screenshotHeightPx: number; // pixel height of the preview image
}

/** Sent from renderer → main with the user-drawn board rectangle (in preview-image coords). */
export interface CalibrationConfirmRegionPayload {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Dimensions of the preview image when the user drew the rect. */
  displayWidth: number;
  displayHeight: number;
}

/** Sent from main → renderer when calibration capture is ready. */
export interface CalibrationInitPayload {
  boardImageDataUrl: string; // data:image/png;base64,…
  boardWidthPx: number;
  boardHeightPx: number;
}
