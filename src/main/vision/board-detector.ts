import sharp from 'sharp';
import { DetectedBoard } from '../../shared/types';

// Minimum and maximum square sizes to search for (pixels)
const MIN_SQUARE = 20;
const MAX_SQUARE = 120;
const BOARD_SQUARES = 8;
// A chess board must be at least this many pixels wide in the original image.
// This prevents tiny false-positive patterns (e.g. favicons, UI grid elements).
const MIN_BOARD_PX = 200;

interface GrayscaleImage {
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * Detects a chess board in the given PNG screenshot buffer.
 * Returns DetectedBoard or null if no board found with sufficient confidence.
 */
export async function detectChessBoard(
  pngBuffer: Buffer,
): Promise<DetectedBoard | null> {
  // 1. Downsample to <= 800px wide for speed
  const sharpImg = sharp(pngBuffer);
  const metadata = await sharpImg.metadata();
  const origWidth = metadata.width ?? 1920;
  const origHeight = metadata.height ?? 1080;

  const scale = origWidth > 800 ? 800 / origWidth : 1.0;
  const scaledWidth = Math.round(origWidth * scale);
  const scaledHeight = Math.round(origHeight * scale);

  // Get raw grayscale pixels
  const { data: grayData } = await sharp(pngBuffer)
    .resize(scaledWidth, scaledHeight, { kernel: 'nearest' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const gray: GrayscaleImage = {
    data: new Uint8Array(grayData),
    width: scaledWidth,
    height: scaledHeight,
  };

  // 2. Build checkerboard contrast score map
  const scoreMap = buildCheckerboardScoreMap(gray);

  // 3. Try various square sizes to find repeating checkerboard period
  let bestResult: DetectedBoard | null = null;
  let bestScore = 0;

  // Square sizes are in downscaled-image pixels.
  // On Retina / HiDPI displays the screenshot is at physical-pixel resolution
  // (e.g. 3024×1964 for a 14" MacBook Pro), so after down-scaling to 800 px
  // wide the board squares can still be very large.  Instead of scaling a
  // fixed MAX_SQUARE constant (which breaks on high-DPI screens), derive the
  // upper bound directly from the downscaled image: the largest possible
  // square is one-eighth of the shortest image dimension.
  const minSq = Math.max(4, Math.round(MIN_SQUARE * scale));
  const maxSq = Math.max(
    minSq + 2,
    Math.floor(Math.min(scaledWidth, scaledHeight) / BOARD_SQUARES),
  );

  for (let sq = minSq; sq <= maxSq; sq += 2) {
    const boardPx = sq * BOARD_SQUARES;
    if (boardPx > scaledWidth || boardPx > scaledHeight) break;

    // Skip if the board would be smaller than MIN_BOARD_PX in original coords
    const boardPxOrig = Math.round(boardPx / scale);
    if (boardPxOrig < MIN_BOARD_PX) continue;

    const result = findBestBoardRegion(gray, scoreMap, sq);
    if (result && result.score > bestScore) {
      bestScore = result.score;
      bestResult = {
        x: Math.round(result.x / scale),
        y: Math.round(result.y / scale),
        width: Math.round(boardPx / scale),
        height: Math.round(boardPx / scale),
        squareSize: Math.round(sq / scale),
        isFlipped: result.isFlipped,
        confidence: result.confidence,
      };
    }
  }

  if (!bestResult || bestResult.confidence < 0.5) {
    console.log('[BoardDetector] No board found');
    return null;
  }

  console.log(
    `[BoardDetector] Board found: x=${bestResult.x} y=${bestResult.y} w=${bestResult.width} sq=${bestResult.squareSize} conf=${(bestResult.confidence * 100).toFixed(1)}% flipped=${bestResult.isFlipped}`,
  );
  return bestResult;
}

/**
 * Compute a local contrast score for each pixel.
 * High score = high local contrast with 4-neighbors (checkerboard characteristic).
 */
function buildCheckerboardScoreMap(gray: GrayscaleImage): Float32Array {
  const { data, width, height } = gray;
  const scores = new Float32Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const center = data[idx];
      const up = data[(y - 1) * width + x];
      const down = data[(y + 1) * width + x];
      const left = data[y * width + (x - 1)];
      const right = data[y * width + (x + 1)];
      scores[idx] =
        (Math.abs(center - up) +
          Math.abs(center - down) +
          Math.abs(center - left) +
          Math.abs(center - right)) /
        4;
    }
  }
  return scores;
}

/**
 * Build prefix sum (integral image) over a float array for O(1) rectangle queries.
 */
function buildIntegralImage(
  scores: Float32Array,
  width: number,
  height: number,
): Float64Array {
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const val = scores[y * width + x];
      integral[(y + 1) * (width + 1) + (x + 1)] =
        val +
        integral[y * (width + 1) + (x + 1)] +
        integral[(y + 1) * (width + 1) + x] -
        integral[y * (width + 1) + x];
    }
  }
  return integral;
}

function queryIntegral(
  integral: Float64Array,
  width: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const w = width + 1;
  return (
    integral[(y2 + 1) * w + (x2 + 1)] -
    integral[y1 * w + (x2 + 1)] -
    integral[(y2 + 1) * w + x1] +
    integral[y1 * w + x1]
  );
}

interface BoardCandidate {
  x: number;
  y: number;
  score: number;
  confidence: number;
  isFlipped: boolean;
}

/**
 * Slide a boardPx × boardPx window over the score map and find the
 * location with highest total contrast score.
 */
function findBestBoardRegion(
  gray: GrayscaleImage,
  scoreMap: Float32Array,
  squareSize: number,
): BoardCandidate | null {
  const boardPx = squareSize * BOARD_SQUARES;
  const { width, height } = gray;

  if (boardPx > width || boardPx > height) return null;

  const integral = buildIntegralImage(scoreMap, width, height);

  let bestScore = -1;
  let bestX = 0;
  let bestY = 0;

  // Stride by squareSize/2 for speed, refine later
  const stride = Math.max(1, Math.round(squareSize / 2));
  for (let y = 0; y <= height - boardPx; y += stride) {
    for (let x = 0; x <= width - boardPx; x += stride) {
      const score = queryIntegral(
        integral,
        width,
        x,
        y,
        x + boardPx - 1,
        y + boardPx - 1,
      );
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
        bestY = y;
      }
    }
  }

  // Refine: search ±squareSize/2 around best position at stride 1
  const refineRange = Math.round(squareSize / 2);
  const x0 = Math.max(0, bestX - refineRange);
  const y0 = Math.max(0, bestY - refineRange);
  const x1 = Math.min(width - boardPx, bestX + refineRange);
  const y1 = Math.min(height - boardPx, bestY + refineRange);

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const score = queryIntegral(
        integral,
        width,
        x,
        y,
        x + boardPx - 1,
        y + boardPx - 1,
      );
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
        bestY = y;
      }
    }
  }

  // Validate: check alternating pattern
  const confidence = validateCheckerboard(gray, bestX, bestY, squareSize);
  if (confidence < 0.5) return null;

  // Detect board flip: a1 is bottom-left for white's perspective
  // a1 square: file a = col 0, rank 1 = row 7 (bottom)
  // If a1 corner is dark, standard orientation (white's POV)
  // If a1 corner is light, it's flipped (black's POV)
  const isFlipped = detectBoardFlip(gray, bestX, bestY, squareSize);

  return {
    x: bestX,
    y: bestY,
    // Normalize by the total length of internal square edges so boards of
    // different sizes score comparably. A chess board has 7 internal lines
    // in each direction, each boardPx pixels long → 2 * 7 * boardPx edge pixels.
    score: bestScore / (2 * 7 * boardPx),
    confidence,
    isFlipped,
  };
}

/**
 * Sample the centers of all 64 squares and check that they follow
 * the alternating light/dark checkerboard pattern.
 * Returns fraction of squares matching expected pattern.
 */
function validateCheckerboard(
  gray: GrayscaleImage,
  boardX: number,
  boardY: number,
  squareSize: number,
): number {
  const { data, width } = gray;
  const half = Math.floor(squareSize / 2);

  // Collect brightness of all 64 square centers
  const brightnesses: number[] = [];
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const cx = boardX + file * squareSize + half;
      const cy = boardY + rank * squareSize + half;
      if (cx >= gray.width || cy >= gray.height) {
        brightnesses.push(128);
        continue;
      }
      brightnesses.push(data[cy * width + cx]);
    }
  }

  // Find median to split light/dark
  const sorted = [...brightnesses].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  // Try both polarities: either (rank+file)%2===0 is light, or it's dark.
  // Return the better-fitting polarity's score so we don't penalise boards
  // where a1 happens to be the light square (e.g. black's perspective).
  let matchesA = 0;
  let matchesB = 0;
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const idx = rank * 8 + file;
      const brightness = brightnesses[idx];
      const patternLight = (rank + file) % 2 === 0;
      const isLight = brightness > median;
      if (isLight === patternLight) matchesA++;
      else matchesB++;
    }
  }

  return Math.max(matchesA, matchesB) / 64;
}

/**
 * Detect if board is flipped (black's perspective).
 * a1 square is: file=0, rank=7 (bottom-left in standard FEN layout)
 * In image coords: col=0, row=7
 * For white's POV: a1 = bottom-left, which is a dark square
 * For black's POV: a1 = top-right
 */
function detectBoardFlip(
  gray: GrayscaleImage,
  boardX: number,
  boardY: number,
  squareSize: number,
): boolean {
  const { data, width } = gray;
  const half = Math.floor(squareSize / 2);

  // Sample bottom-left square center (row 7, col 0)
  const cx = boardX + half;
  const cy = boardY + 7 * squareSize + half;

  if (cx >= gray.width || cy >= gray.height) return false;

  const brightness = data[cy * width + cx];

  // Get average brightness of a few squares to calibrate
  const samples: number[] = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const sx = boardX + j * squareSize + half;
      const sy = boardY + i * squareSize + half;
      if (sx < gray.width && sy < gray.height) {
        samples.push(data[sy * width + sx]);
      }
    }
  }
  const avg = samples.reduce((s, v) => s + v, 0) / samples.length;

  // a1 (bottom-left) should be dark for white's perspective
  // (rank + file) % 2: rank=7, file=0 → 7%2=1 → odd → dark square
  // If brightness > avg, it's a light square → board is flipped
  return brightness > avg;
}
