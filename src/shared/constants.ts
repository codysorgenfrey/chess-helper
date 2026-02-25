// IPC channel names for Electron main ↔ renderer communication

export const IPC = {
  // Renderer → Main (invoke)
  TRIGGER_CAPTURE: 'trigger-capture',
  SET_FEN_MANUAL: 'set-fen-manual',
  GET_SETTINGS: 'get-settings',
  SAVE_SETTINGS: 'save-settings',
  TOGGLE_SIDE: 'toggle-side',
  GET_STATUS: 'get-status',
  GET_CALIBRATION: 'get-calibration',

  // Calibration: Renderer → Main (invoke)
  CALIBRATION_START: 'calibration:start',
  CALIBRATION_CONFIRM_REGION: 'calibration:confirm-region',
  CALIBRATION_CANCEL: 'calibration:cancel',
  CALIBRATION_SAVE: 'calibration:save',

  // Main → Renderer (send)
  ANALYSIS_UPDATE: 'analysis-update',
  STATUS_UPDATE: 'status-update',
  SETTINGS_CHANGED: 'settings-changed',

  // Calibration: Main → Renderer (send)
  CALIBRATION_SCREENSHOT: 'calibration:screenshot',
  CALIBRATION_INIT: 'calibration:init',
  CALIBRATION_COMPLETE: 'calibration:complete',
  CALIBRATION_ERROR: 'calibration:error',
} as const;

// ── Template matching constants ──────────────────────────────────────────────

import type { PieceSymbol } from './types';

/** Size in pixels to which every square is resized for template comparison. */
export const TEMPLATE_SIZE = 48;

/**
 * Standard chess starting position laid out as an 8×8 image grid.
 * Row 0 = rank 8 (top, white-at-bottom perspective).
 * Row 7 = rank 1 (bottom row).
 */
const WHITE_BACK: PieceSymbol[] = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
const BLACK_BACK: PieceSymbol[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];

/**
 * Return the piece at a given image grid position in the starting position.
 * @param imgRow 0–7, top to bottom
 * @param imgCol 0–7, left to right
 * @param isFlipped true when black is at the bottom of the image
 */
export function startingPieceAt(
  imgRow: number,
  imgCol: number,
  isFlipped: boolean,
): PieceSymbol | null {
  // Map image coordinates → actual file (0-7, a=0) and rank (1-8)
  let file: number, rank: number;
  if (!isFlipped) {
    file = imgCol;
    rank = 8 - imgRow;
  } else {
    file = 7 - imgCol;
    rank = imgRow + 1;
  }

  switch (rank) {
    case 1:
      return WHITE_BACK[file];
    case 2:
      return 'P';
    case 7:
      return 'p';
    case 8:
      return BLACK_BACK[file];
    default:
      return null;
  }
}

/**
 * Whether the given image-grid square is a light-coloured square.
 * Consistent across board orientations (relies on (row+col) parity).
 */
export function isLightSquare(imgRow: number, imgCol: number): boolean {
  return (imgRow + imgCol) % 2 === 0;
}
