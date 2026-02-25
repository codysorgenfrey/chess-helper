import sharp from 'sharp';
import {
  CalibrationConfirmRegionPayload,
  CalibrationData,
  CalibrationInitPayload,
  CalibrationScreenshotPayload,
  SquareTemplate,
} from '../../shared/types';
import {
  TEMPLATE_SIZE,
  startingPieceAt,
  isLightSquare,
} from '../../shared/constants';
import { captureScreen } from '../capture/screenshot';

// The preview image sent to the renderer is always scaled so that its longest
// edge is at most PREVIEW_SIZE pixels.
const PREVIEW_SIZE = 560; // px — fits comfortably on most screens

// ── Module-level session state (one calibration at a time) ────────────────────

let screenshotBuffer: Buffer | null = null;
let screenshotWidth = 0;
let screenshotHeight = 0;
let screenshotPreviewW = 0;
let screenshotPreviewH = 0;

let boardImageBuffer: Buffer | null = null; // native-resolution crop
let boardWidthPx = 0;
let boardHeightPx = 0;
let previewWidthPx = 0;
let previewHeightPx = 0;
let boardRect: CalibrationData['boardRect'] | null = null;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Phase 1: capture a full screenshot, scale it down to a preview, and return it.
 * The renderer will show this and let the user draw a rectangle around the board.
 */
export async function captureScreenForCalibration(): Promise<CalibrationScreenshotPayload> {
  boardImageBuffer = null;
  boardRect = null;

  const sc = await captureScreen();
  screenshotBuffer = sc.buffer;
  screenshotWidth = sc.width;
  screenshotHeight = sc.height;

  console.log(
    `[Calibration] Screenshot buffer size: ${screenshotWidth}×${screenshotHeight}`,
  );

  // Scale down to PREVIEW_SIZE (longest edge)
  const longestEdge = Math.max(screenshotWidth, screenshotHeight);
  const scale = longestEdge > PREVIEW_SIZE ? PREVIEW_SIZE / longestEdge : 1;
  screenshotPreviewW = Math.round(screenshotWidth * scale);
  screenshotPreviewH = Math.round(screenshotHeight * scale);

  const previewBuffer = await sharp(screenshotBuffer)
    .resize(screenshotPreviewW, screenshotPreviewH, { kernel: 'lanczos3' })
    .png()
    .toBuffer();

  console.log(
    `[Calibration] Screenshot preview: ${screenshotPreviewW}×${screenshotPreviewH}`,
  );

  return {
    screenshotDataUrl: `data:image/png;base64,${previewBuffer.toString('base64')}`,
    screenshotWidthPx: screenshotPreviewW,
    screenshotHeightPx: screenshotPreviewH,
  };
}

/**
 * Phase 2: the user drew a rectangle on the preview image.
 * Map it to native coords, crop, and return the board preview for confirmation.
 */
export async function confirmBoardRegion(
  payload: CalibrationConfirmRegionPayload,
): Promise<CalibrationInitPayload> {
  if (!screenshotBuffer) {
    throw new Error(
      'No screenshot available — call captureScreenForCalibration() first.',
    );
  }

  // Map preview-image coords → native screenshot coords
  const scaleX = screenshotWidth / payload.displayWidth;
  const scaleY = screenshotHeight / payload.displayHeight;
  const nativeX = Math.round(payload.x * scaleX);
  const nativeY = Math.round(payload.y * scaleY);
  const nativeW = Math.round(payload.width * scaleX);
  const nativeH = Math.round(payload.height * scaleY);

  // Clamp to screenshot bounds
  const left = Math.max(0, Math.min(nativeX, screenshotWidth - 1));
  const top = Math.max(0, Math.min(nativeY, screenshotHeight - 1));
  const right = Math.min(screenshotWidth, nativeX + nativeW);
  const bottom = Math.min(screenshotHeight, nativeY + nativeH);
  const cropW = right - left;
  const cropH = bottom - top;

  if (cropW < 40 || cropH < 40) {
    throw new Error(
      'Selected region is too small. Please draw a larger rectangle around the board.',
    );
  }

  console.log(
    `[Calibration] User region: preview=(${payload.x},${payload.y} ${payload.width}×${payload.height}) → native=(${left},${top} ${cropW}×${cropH})`,
  );

  boardRect = { x: left, y: top, width: cropW, height: cropH };

  // Crop the board at native resolution
  boardImageBuffer = await sharp(screenshotBuffer)
    .extract({ left, top, width: cropW, height: cropH })
    .png()
    .toBuffer();

  const meta = await sharp(boardImageBuffer).metadata();
  boardWidthPx = meta.width ?? cropW;
  boardHeightPx = meta.height ?? cropH;

  console.log(
    `[Calibration] Native board buffer: ${boardWidthPx}×${boardHeightPx}`,
  );

  // Build a fixed-size preview image for the renderer
  const longestEdge = Math.max(boardWidthPx, boardHeightPx);
  const previewScale =
    longestEdge > PREVIEW_SIZE ? PREVIEW_SIZE / longestEdge : 1;
  previewWidthPx = Math.round(boardWidthPx * previewScale);
  previewHeightPx = Math.round(boardHeightPx * previewScale);

  const previewBuffer = await sharp(boardImageBuffer)
    .resize(previewWidthPx, previewHeightPx, { kernel: 'lanczos3' })
    .png()
    .toBuffer();

  console.log(
    `[Calibration] Board preview: ${previewWidthPx}×${previewHeightPx} (scale=${previewScale.toFixed(3)})`,
  );

  // Release the full screenshot — we only need the board crop from here
  screenshotBuffer = null;

  return {
    boardImageDataUrl: `data:image/png;base64,${previewBuffer.toString('base64')}`,
    boardWidthPx: previewWidthPx,
    boardHeightPx: previewHeightPx,
  };
}

/**
 * Phase 3: Auto-extract 64 square templates from the starting position.
 * The user has confirmed that the board shows the starting position and
 * indicated the orientation (isFlipped = black at bottom).
 */
export async function buildCalibrationData(
  isFlipped: boolean,
): Promise<CalibrationData> {
  if (!boardImageBuffer || !boardRect) {
    throw new Error(
      'Board region not set — complete the board selection step first.',
    );
  }

  console.log(
    `[Calibration] Extracting 64 templates (isFlipped=${isFlipped})…`,
  );

  const sqW = boardWidthPx / 8;
  const sqH = boardHeightPx / 8;
  const templates: SquareTemplate[] = [];

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = startingPieceAt(row, col, isFlipped);
      const light = isLightSquare(row, col);

      // Crop inner 70% of the square (reduces border/background influence)
      const marginX = sqW * 0.15;
      const marginY = sqH * 0.15;
      const cropLeft = Math.max(0, Math.round(col * sqW + marginX));
      const cropTop = Math.max(0, Math.round(row * sqH + marginY));
      const cropW2 = Math.min(
        boardWidthPx - cropLeft,
        Math.round(sqW - 2 * marginX),
      );
      const cropH2 = Math.min(
        boardHeightPx - cropTop,
        Math.round(sqH - 2 * marginY),
      );

      // Extract, resize to standard template size, apply small blur for robustness
      const raw = await sharp(boardImageBuffer)
        .extract({
          left: cropLeft,
          top: cropTop,
          width: cropW2,
          height: cropH2,
        })
        .resize(TEMPLATE_SIZE, TEMPLATE_SIZE, { kernel: 'lanczos3' })
        .blur(1.0)
        .removeAlpha()
        .raw()
        .toBuffer();

      templates.push({
        piece,
        isLightSquare: light,
        imageBase64: raw.toString('base64'),
      });

      const label = piece ?? '.';
      const bg = light ? 'L' : 'D';
      if (row === 0 || row === 1 || row === 6 || row === 7) {
        console.log(
          `  [${row},${col}] ${label} on ${bg} → ${raw.length} bytes`,
        );
      }
    }
  }

  console.log(`[Calibration] Extracted ${templates.length} templates`);

  return {
    templates,
    boardRect,
    isFlipped,
    capturedAt: Date.now(),
  };
}

/** Clear all session state without saving. */
export function cancelCalibration(): void {
  screenshotBuffer = null;
  boardImageBuffer = null;
  boardRect = null;
}

/**
 * Return the exact pixel dimensions of the preview image.
 */
export function getBoardDimensions(): { width: number; height: number } {
  return { width: previewWidthPx, height: previewHeightPx };
}
