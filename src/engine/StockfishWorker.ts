/**
 * StockfishWorker.ts
 *
 * Loads the Stockfish WASM engine as a standard Web Worker from /public/stockfish/.
 * Communicates via the native Worker postMessage/onmessage API with UCI protocol.
 *
 * Provides analyze(fen, depth, multiPV) → Promise<EngineMove[]> —
 * the same interface the rest of the app expects.
 */

import { Chess, Square } from 'chess.js';
import { EngineMove } from '../shared/types';

interface MultiPVLine {
  multipv: number;
  depth: number;
  scoreCp: number | null;
  mateIn: number | null;
  pv: string[];
}

export class StockfishWorker {
  private worker: Worker | null = null;
  private engineReady = false;
  private analyzing = false;
  private queue: Array<() => void> = [];

  // Per-analysis state
  private multiPVLines: Map<number, MultiPVLine> = new Map();
  private currentResolve: ((moves: EngineMove[]) => void) | null = null;
  private currentReject: ((err: Error) => void) | null = null;
  private analyzeTimeout: ReturnType<typeof setTimeout> | null = null;

  // Store FEN for convertToSAN in finishAnalysis
  private _currentFen =
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  // Initialization promise so callers can await initialize()
  private initPromise: Promise<void> | null = null;

  /**
   * Load and initialize the Stockfish WASM engine as a Web Worker.
   * Safe to call multiple times — returns the same promise.
   */
  initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Stockfish initialization timed out after 30 s'));
      }, 30_000);

      try {
        // Load the stockfish JS file as a standard Web Worker.
        // The Emscripten-built JS detects the Worker context automatically
        // and wires up onmessage/postMessage for UCI communication.
        this.worker = new Worker('/stockfish/stockfish-nnue-16-single.js');
      } catch (err) {
        clearTimeout(timeout);
        reject(
          new Error(
            `Failed to create Stockfish Worker: ${err instanceof Error ? err.message : err}`,
          ),
        );
        return;
      }

      // Track UCI handshake
      let uciokSeen = false;

      this.worker.onmessage = (e: MessageEvent) => {
        const line =
          typeof e.data === 'string' ? e.data.trim() : String(e.data).trim();
        if (!line) return;

        // During handshake, watch for uciok → isready → readyok
        if (!this.engineReady) {
          if (line === 'uciok' && !uciokSeen) {
            uciokSeen = true;
            this.send('isready');
          }
          if (line === 'readyok') {
            this.engineReady = true;
            clearTimeout(timeout);
            resolve();
          }
        }

        // Forward every line to the analysis handler (it ignores irrelevant lines)
        this.handleLine(line);
      };

      this.worker.onerror = (err) => {
        clearTimeout(timeout);
        console.error('[StockfishWorker] Worker error:', err);
        reject(new Error(`Stockfish Worker error: ${err.message}`));
      };

      // Kick off the UCI handshake
      this.send('uci');
    });

    return this.initPromise;
  }

  // ── Send a UCI command to the Worker ─────────────────────────────────────

  private send(cmd: string): void {
    this.worker?.postMessage(cmd);
  }

  // ── UCI message handler ──────────────────────────────────────────────────

  private handleLine(line: string): void {
    if (!line) return;

    if (line.startsWith('info') && line.includes(' multipv ')) {
      this.parseInfoLine(line);
      return;
    }

    if (line.startsWith('bestmove')) {
      this.finishAnalysis();
      return;
    }
  }

  private parseInfoLine(line: string): void {
    const tokens = line.split(' ');
    let i = 0;

    let depth = 0;
    let multipv = 1;
    let scoreCp: number | null = null;
    let mateIn: number | null = null;
    const pv: string[] = [];

    while (i < tokens.length) {
      const token = tokens[i];
      switch (token) {
        case 'depth':
          depth = parseInt(tokens[++i], 10);
          break;
        case 'multipv':
          multipv = parseInt(tokens[++i], 10);
          break;
        case 'score':
          i++;
          if (tokens[i] === 'cp') {
            scoreCp = parseInt(tokens[++i], 10);
            mateIn = null;
          } else if (tokens[i] === 'mate') {
            mateIn = parseInt(tokens[++i], 10);
            scoreCp = null;
          }
          break;
        case 'pv':
          i++;
          while (i < tokens.length) {
            pv.push(tokens[i++]);
          }
          continue;
      }
      i++;
    }

    if (multipv > 0) {
      this.multiPVLines.set(multipv, { multipv, depth, scoreCp, mateIn, pv });
    }
  }

  private finishAnalysis(): void {
    if (this.analyzeTimeout) {
      clearTimeout(this.analyzeTimeout);
      this.analyzeTimeout = null;
    }

    if (!this.currentResolve) return;

    const rawMoves: EngineMove[] = Array.from(this.multiPVLines.values())
      .sort((a, b) => a.multipv - b.multipv)
      .map((line) => ({
        rank: line.multipv,
        uci: line.pv[0] ?? '',
        san: '',
        scoreCp: line.scoreCp,
        mateIn: line.mateIn,
        depth: line.depth,
        pv: line.pv,
      }));

    const resolve = this.currentResolve;
    this.currentResolve = null;
    this.currentReject = null;

    // Convert UCI → SAN before resolving
    const moves = this.convertToSAN(this._currentFen, rawMoves);
    resolve(moves);
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Analyze a position. Queues if an analysis is already running.
   */
  analyze(fen: string, depth = 18, multiPV = 5): Promise<EngineMove[]> {
    return new Promise<EngineMove[]>((resolve, reject) => {
      const run = () => {
        if (!this.worker || !this.engineReady) {
          reject(new Error('Stockfish engine not ready'));
          this.runNext();
          return;
        }

        this.analyzing = true;
        this._currentFen = fen;
        this.multiPVLines = new Map();
        this.currentResolve = (moves) => {
          resolve(moves);
          this.analyzing = false;
          this.runNext();
        };
        this.currentReject = (err) => {
          reject(err);
          this.analyzing = false;
          this.runNext();
        };

        this.send('ucinewgame');
        this.send(`setoption name MultiPV value ${multiPV}`);
        this.send(`position fen ${fen}`);
        this.send(`go depth ${depth}`);

        // Safety timeout: 30 s
        this.analyzeTimeout = setTimeout(() => {
          this.send('stop');
          // finishAnalysis will fire on the subsequent bestmove response
        }, 30_000);
      };

      if (this.analyzing) {
        this.queue.push(run);
      } else {
        run();
      }
    });
  }

  stopAnalysis(): void {
    if (this.worker && this.engineReady) {
      this.send('stop');
    }
  }

  isReady(): boolean {
    return this.engineReady;
  }

  /**
   * Terminate the Web Worker and release resources.
   */
  destroy(): void {
    if (this.worker) {
      this.send('quit');
      this.worker.terminate();
      this.worker = null;
      this.engineReady = false;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private runNext(): void {
    const next = this.queue.shift();
    if (next) next();
  }

  /**
   * Convert UCI move notation → SAN using chess.js.
   */
  private convertToSAN(fen: string, moves: EngineMove[]): EngineMove[] {
    return moves.map((move) => {
      if (!move.uci || move.uci.length < 4) return move;
      try {
        const chess = new Chess(fen);
        const from = move.uci.slice(0, 2) as Square;
        const to = move.uci.slice(2, 4) as Square;
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
}
