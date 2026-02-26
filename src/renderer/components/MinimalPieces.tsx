/**
 * Chess pieces from the kiwen-suwi set by Lichess.
 * Source: https://github.com/lichess-org/lila/tree/master/public/piece/kiwen-suwi
 * License: AGPL-3.0 (same as Lichess/lila)
 *
 * White pieces use the same flat silhouette as black pieces, recolored to ivory.
 */
import React from 'react';
import { CustomPieceFn } from 'react-chessboard/dist/chessboard/types';

const WHITE = '#ffffff';
const BLACK = '#262626';

function svgPiece(inner: React.ReactNode, fill: string): CustomPieceFn {
  return ({ squareWidth }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      xmlSpace="preserve"
      width={squareWidth}
      height={squareWidth}
      viewBox="0 0 260 260"
      overflow="hidden"
      style={{ display: 'block' }}
    >
      <g fill={fill} fillRule="evenodd">
        {inner}
      </g>
    </svg>
  );
}

// ── Pawn ──────────────────────────────────────────────────────────────────────
// Uses the black pawn shape (bP.svg): simple solid silhouette
const pawnShape = (
  <>
    <defs>
      <clipPath id="P-clip"><path d="M1161 458h259v260h-259z" /></clipPath>
    </defs>
    <g clipPath="url(#P-clip)" transform="translate(-1161 -458)">
      <path d="M1244.58 545.46c0-25.408 20.37-46 45.5-46 25.14 0 45.5 20.592 45.5 46s-20.36 46-45.5 46c-25.13 0-45.5-20.592-45.5-46zM1227.58 682.459l23.2-61.001h78.6l23.2 61.001z" />
    </g>
  </>
);

// ── Rook ──────────────────────────────────────────────────────────────────────
const rookShape = (
  <>
    <defs>
      <clipPath id="R-clip"><path d="M1420 1497h260v260h-260z" /></clipPath>
    </defs>
    <g clipPath="url(#R-clip)" transform="matrix(.95 0 0 .95 -1342.475 -1415.625)">
      <path d="m1479 1732 15.11-96h112.78l15.11 96zM1465 1523h44.08v42.32h20.71V1523h41.42v42.32h20.71V1523H1636v96h-171z" />
    </g>
  </>
);

// ── Knight ────────────────────────────────────────────────────────────────────
const knightShape = (
  <>
    <defs>
      <clipPath id="N-clip"><path d="M2720 1497h260v260h-260z" /></clipPath>
    </defs>
    <g clipPath="url(#N-clip)" transform="matrix(.95 0 0 .95 -2577.325 -1415.625)">
      <path d="M2837.03 1575.38c-9.78 0-17.71 7.97-17.71 17.79 0 9.83 7.93 17.79 17.71 17.79 9.78 0 17.71-7.96 17.71-17.79 0-9.82-7.93-17.79-17.71-17.79zm43.42-19.8c-9.78 0-17.71 7.97-17.71 17.79 0 9.83 7.93 17.79 17.71 17.79 9.78 0 17.71-7.96 17.71-17.79 0-9.82-7.93-17.79-17.71-17.79zM2778.77 1521l53.6 19.62 15.12-6.39c9.51-2.64 19.53-4.14 30.07-4.58 42.16-1.77 79.67 10.29 81.41 53.93 1.2 30.01-38.89 49.32-73.65 58.33l-1.76.42 22.81 91.67h-155.06c-.64-28.1-.62-72.16 10.13-109.41l6.87-15.98-20.31-58.53 41.66 13z" />
    </g>
  </>
);

// ── Bishop ────────────────────────────────────────────────────────────────────
const bishopShape = (
  <>
    <defs>
      <clipPath id="B-clip"><path d="M1680 198h260v260h-260z" /></clipPath>
    </defs>
    <g clipPath="url(#B-clip)" transform="translate(-1680 -198)">
      <path d="m1760.66 379 4.74 4.569c12.73 10.051 28.08 15.92 44.6 15.92 16.52 0 31.87-5.869 44.6-15.92l4.74-4.568L1909.5 430h-199z" />
      <path d="M1809.905 213.661c14.31-.472 26.66 13.616 24 27.573-.38 5.676-4.78 11.263-8.08 14.603 4.74 5.617 9.46 11.233 14.18 16.85-11.08 10.924-22.17 21.849-33.25 32.784 4.47 4.394 8.93 8.798 13.39 13.191 10.54-10.368 21.06-20.746 31.59-31.114 3.29 5.388 7.08 10.517 10.05 16.054 9.35 24.186.61 54.088-21.27 68.641-19.35 13.768-47.77 12.247-65.56-3.419-21.31-17.457-26.65-50.231-12.8-73.761 5.25-8.708 12.68-15.816 18.96-23.778 4.41-5.229 8.81-10.467 13.21-15.696-11.46-8.132-11.38-26.85-.76-35.706 4.42-3.988 10.36-6.249 16.34-6.222z" />
    </g>
  </>
);

// ── Queen ─────────────────────────────────────────────────────────────────────
const queenShape = (
  <>
    <defs>
      <clipPath id="Q-clip"><path d="M1940 198h260v260h-260z" /></clipPath>
    </defs>
    <g clipPath="url(#Q-clip)" transform="translate(-1940 -198)">
      <path d="M2070 231c0 .004 0 .008.01.012l41.8 88.436L2170 247.12 2149.75 430h-159.5L1970 247.12l.1.124 58.09 72.204z" />
    </g>
  </>
);

// ── King ──────────────────────────────────────────────────────────────────────
const kingShape = (
  <>
    <defs>
      <clipPath id="K-clip"><path d="M2460 1497h260v260h-260z" /></clipPath>
    </defs>
    <g clipPath="url(#K-clip)" transform="matrix(.95 0 0 .95 -2330.527 -1415.725)">
      <path d="M2558 1548c0-17.12 13.66-31 30.5-31s30.5 13.88 30.5 31c0 17.12-13.66 31-30.5 31s-30.5-13.88-30.5-31zM2524.14 1592.44c22.074-3.309 43.067 10.78 54.3 28.987 4.857 5.888 8.569 18.756 11.5 21.531 8.112-22.722 24.77-45.368 49.764-50.146 22.378-4.678 45.532 9.507 54.215 30.124 12.13 27.246 4.483 58.583-8.782 83.886-4.735 9.857-11.304 18.572-17.957 27.178h-155.36c-16.084-19.904-28.236-43.54-31.96-69.042-3.65-23.677 3.34-50.88 24.162-64.778 6.01-4.051 12.933-6.753 20.118-7.74z" />
    </g>
  </>
);

export const minimalPieces = {
  wP: svgPiece(pawnShape, WHITE),
  bP: svgPiece(pawnShape, BLACK),
  wR: svgPiece(rookShape, WHITE),
  bR: svgPiece(rookShape, BLACK),
  wN: svgPiece(knightShape, WHITE),
  bN: svgPiece(knightShape, BLACK),
  wB: svgPiece(bishopShape, WHITE),
  bB: svgPiece(bishopShape, BLACK),
  wQ: svgPiece(queenShape, WHITE),
  bQ: svgPiece(queenShape, BLACK),
  wK: svgPiece(kingShape, WHITE),
  bK: svgPiece(kingShape, BLACK),
};
