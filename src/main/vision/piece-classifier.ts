import sharp from 'sharp';
import {
  BoardGrid,
  DetectedBoard,
  PieceSymbol,
  SquareContent,
  SquareTemplate,
} from '../../shared/types';
import { TEMPLATE_SIZE } from '../../shared/constants';
import { getCalibration } from '../store';

// ── Gradient feature extraction ──────────────────────────────────────────────

/**
 * Compute gradient features from raw TEMPLATE_SIZE² × 3 RGB pixels.
 *
 * For each pixel we compute horizontal (dx) and vertical (dy) differences
 * to the right / below neighbour for every RGB channel, yielding 6 values
 * per pixel position.  The result is a Float32Array of length
 * TEMPLATE_SIZE² × 6.
 *
 * **Why gradients?**  A uniform background-colour shift (e.g. green →
 * yellow highlight, or green → red check highlight) adds the same offset
 * to every pixel in the square.  Gradients cancel that offset because
 * they are differences of adjacent pixels, making the features completely
 * invariant to any highlight colour chess.com may apply.
 *
 * - Empty squares → near-zero gradients everywhere.
 * - Pieces → characteristic edge/texture gradient patterns that depend
 *   only on the piece's shape and internal shading, not the background.
 */
function computeGradientFeatures(pixels: Float32Array): Float32Array {
  const S = TEMPLATE_SIZE;
  const features = new Float32Array(S * S * 6);

  for (let r = 0; r < S; r++) {
    for (let c = 0; c < S; c++) {
      const pIdx = (r * S + c) * 3;
      const fIdx = (r * S + c) * 6;

      // Horizontal gradient (dx) — right neighbour minus current
      if (c < S - 1) {
        const rightIdx = (r * S + c + 1) * 3;
        features[fIdx] = pixels[rightIdx] - pixels[pIdx];
        features[fIdx + 1] = pixels[rightIdx + 1] - pixels[pIdx + 1];
        features[fIdx + 2] = pixels[rightIdx + 2] - pixels[pIdx + 2];
      }
      // else: zero-padded (Float32Array initialised to 0)

      // Vertical gradient (dy) — below neighbour minus current
      if (r < S - 1) {
        const belowIdx = ((r + 1) * S + c) * 3;
        features[fIdx + 3] = pixels[belowIdx] - pixels[pIdx];
        features[fIdx + 4] = pixels[belowIdx + 1] - pixels[pIdx + 1];
        features[fIdx + 5] = pixels[belowIdx + 2] - pixels[pIdx + 2];
      }
    }
  }

  return features;
}

// ── Canonical template: averaged gradient representation per piece type ──────

interface CanonicalTemplate {
  piece: SquareContent;
  features: Float32Array; // TEMPLATE_SIZE² × 6 averaged gradient features
  count: number; // how many raw templates were averaged
}

let canonicalTemplates: CanonicalTemplate[] | null = null;
let canonicalForTimestamp = 0;

/**
 * Group the 64 raw templates **by piece only** and average the gradient
 * feature vectors within each group.  Because gradients are background-
 * invariant, light-square and dark-square instances of the same piece
 * produce nearly identical gradient patterns and can be safely averaged
 * together to reduce noise.  This yields ~13 canonical templates.
 */
function buildCanonicalTemplates(
  templates: SquareTemplate[],
  capturedAt: number,
): CanonicalTemplate[] {
  if (canonicalTemplates && canonicalForTimestamp === capturedAt) {
    return canonicalTemplates;
  }

  // Group key: piece symbol or "_" for empty
  const groups = new Map<
    string,
    { piece: SquareContent; featureSets: Float32Array[] }
  >();

  for (const t of templates) {
    const key = t.piece ?? '_';
    const raw = Buffer.from(t.imageBase64, 'base64');
    const pixels = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) pixels[i] = raw[i];

    const feats = computeGradientFeatures(pixels);

    let group = groups.get(key);
    if (!group) {
      group = { piece: t.piece, featureSets: [] };
      groups.set(key, group);
    }
    group.featureSets.push(feats);
  }

  canonicalTemplates = [];
  for (const [, g] of groups) {
    const n = g.featureSets[0].length;
    const avg = new Float32Array(n);
    for (const fs of g.featureSets) {
      for (let i = 0; i < n; i++) avg[i] += fs[i];
    }
    const count = g.featureSets.length;
    for (let i = 0; i < n; i++) avg[i] /= count;

    canonicalTemplates.push({
      piece: g.piece,
      features: avg,
      count,
    });
  }

  canonicalForTimestamp = capturedAt;

  console.log(
    `[Classifier] Built ${canonicalTemplates.length} canonical templates ` +
      `(gradient features, ${TEMPLATE_SIZE}² × 6) ` +
      `from ${templates.length} raw templates`,
  );
  for (const ct of canonicalTemplates) {
    console.log(`  ${ct.piece ?? '.'} (avg of ${ct.count})`);
  }

  return canonicalTemplates;
}

// ── MSE distance ──────────────────────────────────────────────────────────────

/**
 * Mean Squared Error between two same-length float arrays.
 * Lower = more similar.
 */
function mse(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const n = a.length;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return sum / n;
}

// ── Per-square feature extraction ────────────────────────────────────────────

/**
 * Extract the inner 70 % of a board square, resize to TEMPLATE_SIZE²,
 * apply a small blur, and return gradient features ready for MSE comparison.
 */
async function extractSquareFeatures(
  boardPng: Buffer,
  boardW: number,
  boardH: number,
  col: number, // 0–7
  row: number, // 0–7
): Promise<Float32Array> {
  const sqW = boardW / 8;
  const sqH = boardH / 8;

  const marginX = sqW * 0.15;
  const marginY = sqH * 0.15;
  const left = Math.max(0, Math.round(col * sqW + marginX));
  const top = Math.max(0, Math.round(row * sqH + marginY));
  const width = Math.min(boardW - left, Math.round(sqW - 2 * marginX));
  const height = Math.min(boardH - top, Math.round(sqH - 2 * marginY));

  const raw = await sharp(boardPng)
    .extract({ left, top, width, height })
    .resize(TEMPLATE_SIZE, TEMPLATE_SIZE, { kernel: 'lanczos3' })
    .blur(1.0)
    .removeAlpha()
    .raw()
    .toBuffer();

  const pixels = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) pixels[i] = raw[i];

  return computeGradientFeatures(pixels);
}

// ── Full board classification (public API) ───────────────────────────────────

/**
 * Classify all 64 squares using MSE-based template matching.
 *
 * For each square we extract the inner 70 % of the square image, resize to
 * TEMPLATE_SIZE², and compute MSE against every canonical template.
 * The canonical templates are averaged representations of each unique
 * (piece, background-colour) combination from the starting-position
 * calibration set — typically ~13 canonical templates (one per piece type
 * plus one for empty squares).
 *
 * Both calibration templates and query squares are converted to **gradient
 * features** (horizontal and vertical pixel differences) which are completely
 * invariant to any uniform background-colour shift — chess.com's yellow
 * last-move highlights, red check markers, blue premove indicators, etc.
 *
 * Returns an 8×8 BoardGrid and a confidence score (0–1).
 */
export async function classifyPieces(
  pngBuffer: Buffer,
  board: DetectedBoard,
): Promise<{ grid: BoardGrid; confidence: number }> {
  const cal = getCalibration();
  if (!cal) {
    throw new Error(
      'Board not calibrated. Please run the calibration wizard before analyzing.',
    );
  }

  // Extract the board region from the screenshot
  const boardPng = await sharp(pngBuffer)
    .extract({
      left: Math.max(0, board.x),
      top: Math.max(0, board.y),
      width: board.width,
      height: board.height,
    })
    .png()
    .toBuffer();

  const meta = await sharp(boardPng).metadata();
  const boardW = meta.width ?? board.width;
  const boardH = meta.height ?? board.height;

  // Build deduplicated canonical templates (cached after first call)
  const templates = buildCanonicalTemplates(cal.templates, cal.capturedAt);

  const grid: BoardGrid = Array.from({ length: 8 }, () => Array(8).fill(null));
  let totalMargin = 0;

  const files = 'abcdefgh';
  const ranks = '87654321';

  console.log(
    '[Classifier] board x=%d y=%d w=%d h=%d sq=%d flipped=%s',
    board.x,
    board.y,
    board.width,
    board.height,
    board.squareSize,
    board.isFlipped,
  );

  for (let imgRow = 0; imgRow < 8; imgRow++) {
    for (let imgCol = 0; imgCol < 8; imgCol++) {
      const features = await extractSquareFeatures(
        boardPng,
        boardW,
        boardH,
        imgCol,
        imgRow,
      );

      // Score every canonical template by MSE (lower = better)
      let bestMSE = Infinity;
      let secondBestMSE = Infinity;
      let bestPiece: SquareContent = null;

      for (const tmpl of templates) {
        const d = mse(features, tmpl.features);

        if (d < bestMSE) {
          secondBestMSE = bestMSE;
          bestMSE = d;
          bestPiece = tmpl.piece;
        } else if (d < secondBestMSE) {
          secondBestMSE = d;
        }
      }

      // Map image coords → board coords
      const boardRank = board.isFlipped ? imgRow : 7 - imgRow;
      const boardFile = board.isFlipped ? 7 - imgCol : imgCol;
      grid[7 - boardRank][boardFile] = bestPiece;

      // Confidence margin: ratio of (second-best − best) / second-best
      // Higher means the best match is clearly better than any alternative.
      const margin =
        secondBestMSE > 0
          ? Math.min(1, (secondBestMSE - bestMSE) / secondBestMSE)
          : 0;
      totalMargin += margin;

      console.log(
        `  [sq ${files[boardFile]}${ranks[7 - boardRank]}]` +
          ` piece=${bestPiece ?? '.'} mse=${bestMSE.toFixed(0)}` +
          ` margin=${margin.toFixed(2)}`,
      );
    }
  }

  const confidence = totalMargin / 64;

  // Print ASCII board
  console.log('[Classifier] Detected grid:');
  for (let r = 0; r < 8; r++) {
    const row = grid[r]
      .map((p: SquareContent) => (p === null ? '.' : (p as PieceSymbol)))
      .join(' ');
    console.log(`  ${ranks[r]} | ${row}`);
  }
  console.log('    +-----------------');
  console.log(`      ${files.split('').join(' ')}`);
  console.log(
    `[Classifier] overall confidence: ${(confidence * 100).toFixed(1)}%`,
  );

  return { grid, confidence };
}
