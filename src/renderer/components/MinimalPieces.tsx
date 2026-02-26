/**
 * Minimal flat chess pieces using clean SVG geometry.
 * Inspired by simple/abstract chess sets — no gradients, no outlines,
 * just solid shapes with a subtle stroke for contrast on both square colors.
 */
import React from 'react';
import { CustomPieceFn } from 'react-chessboard/dist/chessboard/types';

const W = '#f0ede0'; // white piece fill
const B = '#2a2a2a'; // black piece fill
const STROKE_W = 'rgba(0,0,0,0.35)'; // stroke on white pieces
const STROKE_B = 'rgba(255,255,255,0.18)'; // stroke on black pieces
const SW = 0.8; // stroke width

function piece(fill: string, stroke: string, shape: React.ReactNode): CustomPieceFn {
  return ({ squareWidth }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 45 45"
      width={squareWidth}
      height={squareWidth}
      style={{ display: 'block' }}
    >
      <g fill={fill} stroke={stroke} strokeWidth={SW} strokeLinejoin="round">
        {shape}
      </g>
    </svg>
  );
}

// ── Pawn ─────────────────────────────────────────────────────────────────────
const wPawn = piece(
  W,
  STROKE_W,
  <>
    {/* Base */}
    <rect x="11" y="36" width="23" height="4" rx="2" />
    {/* Stem */}
    <rect x="16" y="29" width="13" height="8" rx="1" />
    {/* Head */}
    <circle cx="22.5" cy="23" r="6.5" />
  </>,
);

const bPawn = piece(
  B,
  STROKE_B,
  <>
    <rect x="11" y="36" width="23" height="4" rx="2" />
    <rect x="16" y="29" width="13" height="8" rx="1" />
    <circle cx="22.5" cy="23" r="6.5" />
  </>,
);

// ── Rook ─────────────────────────────────────────────────────────────────────
const wRook = piece(
  W,
  STROKE_W,
  <>
    {/* Base */}
    <rect x="9" y="37" width="27" height="4" rx="2" />
    {/* Body */}
    <rect x="12" y="20" width="21" height="18" rx="2" />
    {/* Battlements */}
    <rect x="11" y="14" width="6" height="8" rx="1" />
    <rect x="19.5" y="14" width="6" height="8" rx="1" />
    <rect x="28" y="14" width="6" height="8" rx="1" />
  </>,
);

const bRook = piece(
  B,
  STROKE_B,
  <>
    <rect x="9" y="37" width="27" height="4" rx="2" />
    <rect x="12" y="20" width="21" height="18" rx="2" />
    <rect x="11" y="14" width="6" height="8" rx="1" />
    <rect x="19.5" y="14" width="6" height="8" rx="1" />
    <rect x="28" y="14" width="6" height="8" rx="1" />
  </>,
);

// ── Knight ────────────────────────────────────────────────────────────────────
const wKnight = piece(
  W,
  STROKE_W,
  <>
    {/* Base */}
    <rect x="9" y="37" width="27" height="4" rx="2" />
    {/* Body — abstract horse-head silhouette */}
    <path d="M14 37 L14 28 Q12 22 15 17 Q17 12 22 11 Q28 10 30 15 Q33 20 28 25 L28 37 Z" />
    {/* Ear notch */}
    <path d="M19 11 L22 7 L25 11" />
  </>,
);

const bKnight = piece(
  B,
  STROKE_B,
  <>
    <rect x="9" y="37" width="27" height="4" rx="2" />
    <path d="M14 37 L14 28 Q12 22 15 17 Q17 12 22 11 Q28 10 30 15 Q33 20 28 25 L28 37 Z" />
    <path d="M19 11 L22 7 L25 11" />
  </>,
);

// ── Bishop ────────────────────────────────────────────────────────────────────
const wBishop = piece(
  W,
  STROKE_W,
  <>
    {/* Base */}
    <rect x="9" y="37" width="27" height="4" rx="2" />
    {/* Foot */}
    <rect x="13" y="32" width="19" height="6" rx="2" />
    {/* Body */}
    <path d="M22.5 12 Q29 18 28 31 L17 31 Q16 18 22.5 12 Z" />
    {/* Tip dot */}
    <circle cx="22.5" cy="10" r="2.5" />
  </>,
);

const bBishop = piece(
  B,
  STROKE_B,
  <>
    <rect x="9" y="37" width="27" height="4" rx="2" />
    <rect x="13" y="32" width="19" height="6" rx="2" />
    <path d="M22.5 12 Q29 18 28 31 L17 31 Q16 18 22.5 12 Z" />
    <circle cx="22.5" cy="10" r="2.5" />
  </>,
);

// ── Queen ─────────────────────────────────────────────────────────────────────
const wQueen = piece(
  W,
  STROKE_W,
  <>
    {/* Base */}
    <rect x="9" y="37" width="27" height="4" rx="2" />
    {/* Body */}
    <path d="M13 36 L16 19 L22.5 25 L29 19 L32 36 Z" />
    {/* Crown points */}
    <circle cx="13" cy="17" r="3" />
    <circle cx="22.5" cy="14" r="3" />
    <circle cx="32" cy="17" r="3" />
  </>,
);

const bQueen = piece(
  B,
  STROKE_B,
  <>
    <rect x="9" y="37" width="27" height="4" rx="2" />
    <path d="M13 36 L16 19 L22.5 25 L29 19 L32 36 Z" />
    <circle cx="13" cy="17" r="3" />
    <circle cx="22.5" cy="14" r="3" />
    <circle cx="32" cy="17" r="3" />
  </>,
);

// ── King ──────────────────────────────────────────────────────────────────────
const wKing = piece(
  W,
  STROKE_W,
  <>
    {/* Base */}
    <rect x="9" y="37" width="27" height="4" rx="2" />
    {/* Body */}
    <path d="M13 36 L15 20 L30 20 L32 36 Z" />
    {/* Collar */}
    <rect x="13" y="17" width="19" height="4" rx="1" />
    {/* Cross vertical */}
    <rect x="21" y="8" width="3" height="11" rx="1" />
    {/* Cross horizontal */}
    <rect x="17" y="11" width="11" height="3" rx="1" />
  </>,
);

const bKing = piece(
  B,
  STROKE_B,
  <>
    <rect x="9" y="37" width="27" height="4" rx="2" />
    <path d="M13 36 L15 20 L30 20 L32 36 Z" />
    <rect x="13" y="17" width="19" height="4" rx="1" />
    <rect x="21" y="8" width="3" height="11" rx="1" />
    <rect x="17" y="11" width="11" height="3" rx="1" />
  </>,
);

export const minimalPieces = {
  wP: wPawn,
  bP: bPawn,
  wR: wRook,
  bR: bRook,
  wN: wKnight,
  bN: bKnight,
  wB: wBishop,
  bB: bBishop,
  wQ: wQueen,
  bQ: bQueen,
  wK: wKing,
  bK: bKing,
};
