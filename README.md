# Chess Helper

A browser-based chess coaching and analysis tool powered by Stockfish WASM.

## Setup

```bash
npm install
```

## Development

```bash
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Usage

- **Enter a FEN** to load any position
- **Toggle side to move** with the W / B buttons
- **Coach mode**: get hints and move evaluations as you play against the engine
- **Modeler mode**: see the top 5 engine moves with evaluations and strength bars

## How It Works

1. Enter a FEN string or use the starting position
2. Stockfish WASM runs in a Web Worker (depth 18, MultiPV 5)
3. Top moves are displayed with centipawn evaluations and principal variations
