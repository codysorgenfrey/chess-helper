# Chess Helper Overlay

An always-on-top Electron overlay that detects chess boards on your screen and shows the top 5 best moves using Stockfish.

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Download Stockfish

Download the appropriate Stockfish binary from https://stockfishchess.org/download/ and place it in `assets/stockfish/`:

| Platform | Filename |
|----------|----------|
| macOS | `assets/stockfish/stockfish-mac` |
| Windows | `assets/stockfish/stockfish-win.exe` |
| Linux | `assets/stockfish/stockfish-linux` |

Make the binary executable (macOS/Linux):
```bash
chmod +x assets/stockfish/stockfish-mac
```

### 3. Run in Development

```bash
npm start
```

### 4. macOS Screen Recording Permission

On first launch, macOS will prompt for Screen Recording permission. Go to:
**System Settings → Privacy & Security → Screen Recording** and enable Chess Helper Overlay, then restart the app.

## Usage

| Action | How |
|--------|-----|
| Analyze board | Press **⌘⇧C** (Cmd+Shift+C) |
| Move window | Drag the title bar |
| Toggle side to move | Click **W** or **B** buttons |
| Manual FEN entry | Click the ✎ button or press ⌘⇧C when no board is detected |
| Hide/show overlay | Double-click the tray icon |
| Quit | Right-click tray → Quit |

## How It Works

1. **Screenshot**: Captures your screen when you press ⌘⇧C
2. **Board Detection**: Finds checkerboard patterns using contrast analysis
3. **Piece Classification**: Identifies pieces by brightness/color heuristics
4. **FEN Assembly**: Builds a valid FEN string (validated with chess.js)
5. **Engine Analysis**: Runs Stockfish at depth 18 with MultiPV 5
6. **Display**: Shows top 5 moves with evaluations and strength bars

## Notes

- Piece detection works best with standard piece sets (Chess.com default, Lichess CBurnett)
- If auto-detection fails, use the manual FEN input (✎ button)
- Board orientation is auto-detected; toggle W/B if it's wrong
- En passant cannot be detected from a static screenshot; use manual FEN for those positions

## Package for Distribution

```bash
npm run make
```
# chess-helper
