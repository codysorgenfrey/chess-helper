import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import { EngineMove } from '../../shared/types';

interface MultiPVLine {
  multipv: number;
  depth: number;
  scoreCp: number | null;
  mateIn: number | null;
  pv: string[];
}

export class StockfishProcess extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private ready = false;
  private buffer = '';
  private currentResolve: ((moves: EngineMove[]) => void) | null = null;
  private currentReject: ((err: Error) => void) | null = null;
  private multiPVLines: Map<number, MultiPVLine> = new Map();
  private analyzeTimeout: NodeJS.Timeout | null = null;

  constructor(private stockfishPath: string) {
    super();
  }

  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.proc = spawn(this.stockfishPath, [], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        this.proc.stdout.on('data', (data: Buffer) => {
          this.buffer += data.toString();
          const lines = this.buffer.split('\n');
          this.buffer = lines.pop() ?? '';
          for (const line of lines) {
            this.handleLine(line.trim());
          }
        });

        this.proc.stderr.on('data', (data: Buffer) => {
          console.error('[Stockfish stderr]', data.toString());
        });

        this.proc.on('error', (err) => {
          console.error('[Stockfish process error]', err);
          this.emit('error', err);
          reject(err);
        });

        this.proc.on('exit', (code) => {
          console.log('[Stockfish] exited with code', code);
          this.ready = false;
          this.emit('exit', code);
        });

        // UCI handshake
        this.once('uciok', () => {
          this.send('isready');
        });

        this.once('readyok', () => {
          this.ready = true;
          resolve();
        });

        // Timeout for initialization
        const initTimeout = setTimeout(() => {
          reject(new Error('Stockfish initialization timed out'));
        }, 10000);

        this.once('readyok', () => clearTimeout(initTimeout));

        this.send('uci');
      } catch (err) {
        reject(err);
      }
    });
  }

  private handleLine(line: string): void {
    if (!line) return;

    // Uncomment for debugging:
    // console.log('[SF]', line);

    if (line === 'uciok') {
      this.emit('uciok');
      return;
    }

    if (line === 'readyok') {
      this.emit('readyok');
      return;
    }

    if (line.startsWith('info') && line.includes('multipv')) {
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

    const moves: EngineMove[] = Array.from(this.multiPVLines.values())
      .sort((a, b) => a.multipv - b.multipv)
      .map((line) => ({
        rank: line.multipv,
        uci: line.pv[0] ?? '',
        san: '', // will be converted by engine-manager
        scoreCp: line.scoreCp,
        mateIn: line.mateIn,
        depth: line.depth,
        pv: line.pv,
      }));

    const resolve = this.currentResolve;
    this.currentResolve = null;
    this.currentReject = null;
    resolve(moves);
  }

  analyze(fen: string, depth: number, multiPV: number): Promise<EngineMove[]> {
    return new Promise((resolve, reject) => {
      if (!this.ready || !this.proc) {
        reject(new Error('Stockfish is not ready'));
        return;
      }

      this.multiPVLines = new Map();
      this.currentResolve = resolve;
      this.currentReject = reject;

      this.send('ucinewgame');
      this.send(`setoption name MultiPV value ${multiPV}`);
      this.send(`position fen ${fen}`);
      this.send(`go depth ${depth}`);

      // Safety timeout
      this.analyzeTimeout = setTimeout(() => {
        this.send('stop');
        // finishAnalysis will be triggered by the bestmove response
      }, 30000);
    });
  }

  stopAnalysis(): void {
    if (this.proc && this.ready) {
      this.send('stop');
    }
  }

  send(cmd: string): void {
    if (this.proc?.stdin?.writable) {
      this.proc.stdin.write(cmd + '\n');
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  shutdown(): void {
    if (this.proc) {
      this.send('quit');
      setTimeout(() => {
        if (this.proc) {
          this.proc.kill();
          this.proc = null;
        }
      }, 1000);
      this.ready = false;
    }
  }
}
