import * as path from 'path';
import * as fs from 'fs';
import { Chess } from 'chess.js';
import { app } from 'electron';
import { StockfishProcess } from './stockfish-process';
import { EngineMove } from '../../shared/types';

export class EngineManager {
  private engine: StockfishProcess | null = null;
  private analyzing = false;
  private queue: Array<() => void> = [];

  /**
   * Find the Stockfish binary in common locations.
   */
  static findStockfishPath(overridePath?: string): string {
    if (overridePath && fs.existsSync(overridePath)) {
      return overridePath;
    }

    // Try extraResources path (packaged app)
    const platform = process.platform;
    const binaryName =
      platform === 'win32'
        ? 'stockfish-win.exe'
        : platform === 'darwin'
        ? 'stockfish-mac'
        : 'stockfish-linux';

    const resourcesPath = process.resourcesPath ?? '';
    const extraResourcePath = path.join(resourcesPath, 'stockfish', binaryName);
    if (fs.existsSync(extraResourcePath)) {
      return extraResourcePath;
    }

    // Try assets/stockfish relative to app path (dev mode: app.getAppPath() = .vite/build)
    const devPath = path.join(app.getAppPath(), 'assets', 'stockfish', binaryName);
    if (fs.existsSync(devPath)) {
      return devPath;
    }

    // Try project root relative to __dirname (dev: .vite/build → ../../assets/stockfish)
    const fromDirname = path.join(__dirname, '..', '..', 'assets', 'stockfish', binaryName);
    if (fs.existsSync(fromDirname)) {
      return fromDirname;
    }

    // Try one more level up (in case of different build output depth)
    const fromDirname2 = path.join(__dirname, '..', '..', '..', 'assets', 'stockfish', binaryName);
    if (fs.existsSync(fromDirname2)) {
      return fromDirname2;
    }

    // Try system PATH (user has stockfish installed)
    const systemName = platform === 'win32' ? 'stockfish.exe' : 'stockfish';
    return systemName; // will fail with helpful error if not found
  }

  async initialize(stockfishPath?: string): Promise<void> {
    const sfPath = EngineManager.findStockfishPath(stockfishPath);
    console.log('[EngineManager] Using Stockfish at:', sfPath);

    this.engine = new StockfishProcess(sfPath);

    try {
      await this.engine.initialize();
      console.log('[EngineManager] Stockfish ready');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to start Stockfish: ${msg}\n\n` +
          `Please download Stockfish from https://stockfishchess.org/download/ ` +
          `and place the binary at: assets/stockfish/${path.basename(sfPath)}`
      );
    }
  }

  /**
   * Analyze a FEN position and return top N moves.
   * Queues requests so only one analysis runs at a time.
   */
  analyze(fen: string, depth = 18, multiPV = 5): Promise<EngineMove[]> {
    return new Promise((resolve, reject) => {
      const run = async () => {
        if (!this.engine || !this.engine.isReady()) {
          reject(new Error('Engine not initialized'));
          this.runNext();
          return;
        }

        this.analyzing = true;
        try {
          const rawMoves = await this.engine.analyze(fen, depth, multiPV);
          const moves = this.convertToSAN(fen, rawMoves);
          resolve(moves);
        } catch (err) {
          reject(err);
        } finally {
          this.analyzing = false;
          this.runNext();
        }
      };

      if (this.analyzing) {
        this.queue.push(run);
      } else {
        run();
      }
    });
  }

  private runNext(): void {
    const next = this.queue.shift();
    if (next) next();
  }

  /**
   * Convert UCI move notation to SAN using chess.js.
   */
  private convertToSAN(fen: string, moves: EngineMove[]): EngineMove[] {
    return moves.map((move) => {
      if (!move.uci || move.uci.length < 4) return move;

      try {
        const chess = new Chess(fen);
        const from = move.uci.slice(0, 2) as `${'a'|'b'|'c'|'d'|'e'|'f'|'g'|'h'}${'1'|'2'|'3'|'4'|'5'|'6'|'7'|'8'}`;
        const to = move.uci.slice(2, 4) as `${'a'|'b'|'c'|'d'|'e'|'f'|'g'|'h'}${'1'|'2'|'3'|'4'|'5'|'6'|'7'|'8'}`;
        const promotion = move.uci.length === 5 ? move.uci[4] : undefined;

        const result = chess.move({
          from,
          to,
          promotion: promotion as 'q' | 'r' | 'b' | 'n' | undefined,
        });

        return { ...move, san: result?.san ?? move.uci };
      } catch {
        return { ...move, san: move.uci };
      }
    });
  }

  isReady(): boolean {
    return this.engine?.isReady() ?? false;
  }

  shutdown(): void {
    this.engine?.shutdown();
    this.engine = null;
  }
}
