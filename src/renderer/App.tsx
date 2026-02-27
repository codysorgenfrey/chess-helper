import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  AppMode,
  BotDifficulty,
  HintResult,
  MoveEvaluation,
} from '../shared/types';
import { FenInput } from './components/FenInput';
import { InteractiveBoard } from './components/InteractiveBoard';
import { CoachingPanel } from './components/CoachingPanel';
import { ModelerPanel } from './components/ModelerPanel';
import { useChessEngine } from '../engine/useChessEngine';

const DIFFICULTY_LABELS: Record<BotDifficulty, string> = {
  1: 'Beginner',
  2: 'Casual',
  3: 'Intermediate',
  4: 'Advanced',
  5: 'Master',
};

export default function App(): React.ReactElement {
  // ── Engine hook (replaces window.chessHelper.* IPC) ──
  const engine = useChessEngine();

  // ── Mode ──
  const [mode, setMode] = useState<AppMode>('coach');

  const [showFenInput, setShowFenInput] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [hint, setHint] = useState<HintResult | null>(null);
  const [moveEvaluation, setMoveEvaluation] = useState<MoveEvaluation | null>(
    null,
  );
  const [currentFen, setCurrentFen] = useState(
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  );
  const [gameOver, setGameOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Coach mode state ──
  const [difficulty, setDifficulty] = useState<BotDifficulty>(3);
  const [playerColor, setPlayerColor] = useState<'white' | 'black'>(() =>
    Math.random() < 0.5 ? 'white' : 'black',
  );
  const [isBotThinking, setIsBotThinking] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [alwaysEvaluate, setAlwaysEvaluate] = useState(true);

  // ── Modeler mode state ──
  const [autoAnalyze, setAutoAnalyze] = useState(false);

  const pendingHintRef = useRef<HintResult | null>(null);

  // Ref to trigger bot move from the board component
  const triggerBotMoveRef = useRef<
    ((moveUci: string, moveSan: string) => void) | null
  >(null);

  // ── Mode switching ──
  const handleModeChange = useCallback(
    (newMode: AppMode) => {
      if (newMode === mode) return;
      setMode(newMode);
      setHint(null);
      setMoveEvaluation(null);
      setError(null);
      setGameOver(false);
      setIsBotThinking(false);
      setGameStarted(false);
      pendingHintRef.current = null;
      setCurrentFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    },
    [mode],
  );

  // ── Bot move logic (coach mode only) ──
  const requestBotMove = useCallback(
    async (fen: string) => {
      if (mode !== 'coach') return;
      setIsBotThinking(true);
      try {
        const result = await engine.getBotMove(fen, difficulty);
        if ('error' in result) {
          setError(result.error);
        } else {
          triggerBotMoveRef.current?.(result.moveUci, result.moveSan);
          setCurrentFen(result.fen);
        }
      } catch (err) {
        setError(String(err));
      } finally {
        setIsBotThinking(false);
      }
    },
    [difficulty, mode, engine],
  );

  // ── Hint (coach mode) ──
  const handleRequestHint = useCallback(async () => {
    setIsThinking(true);
    setError(null);

    try {
      const result = await engine.getHint(currentFen);
      if ('error' in result) {
        setError(result.error);
        setHint(null);
        pendingHintRef.current = null;
      } else {
        setHint(result);
        pendingHintRef.current = result;
      }
    } catch (err) {
      setError(String(err));
      setHint(null);
      pendingHintRef.current = null;
    } finally {
      setIsThinking(false);
    }
  }, [currentFen, engine]);

  // ── Move made on board ──
  const handleMoveMade = useCallback(
    async (info: {
      fenBefore: string;
      moveUci: string;
      moveSan: string;
      fenAfter: string;
      isUserMove: boolean;
    }) => {
      setCurrentFen(info.fenAfter);
      setError(null);

      // Modeler mode: just update FEN (ModelerPanel reacts via useEffect)
      if (mode === 'modeler') return;

      // Coach mode: only handle user moves here
      if (!info.isUserMove) return;

      setGameStarted(true);

      if (pendingHintRef.current || alwaysEvaluate) {
        setIsThinking(true);
        try {
          const result = await engine.evaluateMove(
            info.fenBefore,
            info.moveUci,
            info.moveSan,
          );
          if ('error' in result) {
            setError(result.error);
          } else {
            setMoveEvaluation(result);
          }
        } catch (err) {
          setError(String(err));
        } finally {
          setIsThinking(false);
          pendingHintRef.current = null;
        }
      } else {
        setHint(null);
        setMoveEvaluation(null);
      }

      // Bot responds after a short delay
      setTimeout(() => {
        requestBotMove(info.fenAfter);
      }, 300);
    },
    [mode, requestBotMove, engine, alwaysEvaluate],
  );

  // ── Undo (coach mode) ──
  const handleUndo = useCallback((restoredFen: string) => {
    setCurrentFen(restoredFen);
    setHint(null);
    setMoveEvaluation(null);
    setError(null);
    setGameOver(false);
    setIsBotThinking(false);
    pendingHintRef.current = null;
  }, []);

  // ── Reset ──
  const handleReset = useCallback(() => {
    const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    setCurrentFen(startFen);
    setHint(null);
    setMoveEvaluation(null);
    setError(null);
    setGameOver(false);
    setIsBotThinking(false);
    setGameStarted(false);
    pendingHintRef.current = null;

    if (mode === 'coach' && playerColor === 'black') {
      setTimeout(() => {
        requestBotMove(startFen);
      }, 500);
    }
  }, [mode, playerColor, requestBotMove]);

  const handleGameOver = useCallback(() => {
    setGameOver(true);
    setHint(null);
    pendingHintRef.current = null;
  }, []);

  const handleDismissEvaluation = useCallback(() => {
    setMoveEvaluation(null);
  }, []);

  const handleFenSubmit = useCallback(async (fen: string) => {
    setCurrentFen(fen);
    setHint(null);
    setMoveEvaluation(null);
    setError(null);
    pendingHintRef.current = null;
    setShowFenInput(false);
  }, []);

  const showFenToggle = useCallback(() => {
    setShowFenInput((v) => !v);
  }, []);

  const handleColorChange = useCallback((color: 'white' | 'black') => {
    setPlayerColor(color);
  }, []);

  // On mount, if player is black the bot (white) needs to move first
  const hasFiredInitialBot = useRef(false);
  useEffect(() => {
    if (
      mode === 'coach' &&
      playerColor === 'black' &&
      !hasFiredInitialBot.current
    ) {
      hasFiredInitialBot.current = true;
      const startFen =
        'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      setTimeout(() => requestBotMove(startFen), 500);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sideToMove = currentFen.split(' ')[1] === 'w' ? 'white' : 'black';
  const isPlayerTurn = sideToMove === playerColor;

  return (
    <div className="app-container">
      {/* Title bar */}
      <div className="title-bar">
        <span className="title-icon">♟</span>
        <span className="title-text">Chess Helper</span>
        {!engine.isReady && (
          <span className="engine-loading">Loading engine…</span>
        )}
        <button
          className="btn-icon"
          onClick={showFenToggle}
          title="Enter FEN manually"
          aria-label="Toggle FEN input"
        >
          ✎
        </button>
      </div>

      {/* Mode tabs */}
      <div className="mode-tabs">
        <button
          className={`mode-tab ${mode === 'modeler' ? 'mode-tab--active' : ''}`}
          onClick={() => handleModeChange('modeler')}
        >
          🔍 Modeler
        </button>
        <button
          className={`mode-tab ${mode === 'coach' ? 'mode-tab--active' : ''}`}
          onClick={() => handleModeChange('coach')}
        >
          🎓 Coach
        </button>
      </div>

      {/* Modeler settings bar (only in modeler mode) */}
      {mode === 'modeler' && (
        <div className="settings-bar">
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={autoAnalyze}
              onChange={() => setAutoAnalyze((v) => !v)}
            />
            <span className="settings-label">Auto-analyze</span>
          </label>
        </div>
      )}

      {/* Coach settings bar (only in coach mode) */}
      {mode === 'coach' && (
        <div className="settings-bar">
          <div className="difficulty-selector">
            <span className="settings-label">Bot</span>
            <div className="difficulty-buttons">
              {([1, 2, 3, 4, 5] as BotDifficulty[]).map((d) => (
                <button
                  key={d}
                  className={`difficulty-btn ${difficulty === d ? 'difficulty-btn--active' : ''}`}
                  onClick={() => setDifficulty(d)}
                  title={DIFFICULTY_LABELS[d]}
                  disabled={gameStarted}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div className="color-selector">
            <span className="settings-label">Play as</span>
            <div className="color-buttons">
              <button
                className={`color-btn ${playerColor === 'white' ? 'color-btn--active' : ''}`}
                onClick={() => handleColorChange('white')}
                title="Play as White"
                disabled={gameStarted}
              >
                <span className="color-icon color-icon--white" />
              </button>
              <button
                className={`color-btn ${playerColor === 'black' ? 'color-btn--active' : ''}`}
                onClick={() => handleColorChange('black')}
                title="Play as Black"
                disabled={gameStarted}
              >
                <span className="color-icon color-icon--black" />
              </button>
            </div>
          </div>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={alwaysEvaluate}
              onChange={() => setAlwaysEvaluate((v) => !v)}
            />
            <span className="settings-label">Evaluate</span>
          </label>
        </div>
      )}

      {/* Main content — responsive two-column on desktop, stacked on mobile */}
      <div className="app-main">
        {/* Board column */}
        <div className="app-board-col">
          <InteractiveBoard
            mode={mode}
            onMoveMade={handleMoveMade}
            onReset={handleReset}
            onUndo={handleUndo}
            onGameOver={handleGameOver}
            hint={hint}
            moveEvaluation={moveEvaluation}
            isThinking={isThinking || isBotThinking}
            playerColor={playerColor}
            isBotThinking={isBotThinking}
            triggerBotMoveRef={triggerBotMoveRef}
          />

          {/* FEN input — shown below board on mobile, inline on desktop */}
          {showFenInput && (
            <FenInput
              currentFen={currentFen}
              onSubmit={handleFenSubmit}
              onClose={() => setShowFenInput(false)}
            />
          )}
        </div>

        {/* Panel column */}
        <div className="app-panel-col">
          {mode === 'coach' ? (
            <CoachingPanel
              hint={hint}
              moveEvaluation={moveEvaluation}
              isThinking={isThinking}
              isBotThinking={isBotThinking}
              onRequestHint={handleRequestHint}
              canRequestHint={
                engine.isReady &&
                !isThinking &&
                !gameOver &&
                !isBotThinking &&
                isPlayerTurn
              }
              gameOver={gameOver}
              error={error}
              onDismissEvaluation={handleDismissEvaluation}
            />
          ) : (
            <ModelerPanel
              currentFen={currentFen}
              autoAnalyze={autoAnalyze}
              analyzePosition={engine.analyzePosition}
            />
          )}
        </div>
      </div>
    </div>
  );
}
