import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  AppMode,
  BotDifficulty,
  HintResult,
  MoveEvaluation,
  StatusUpdate,
} from '../shared/types';
import { FenInput } from './components/FenInput';
import { InteractiveBoard } from './components/InteractiveBoard';
import { CoachingPanel } from './components/CoachingPanel';
import { ModelerPanel } from './components/ModelerPanel';

const DIFFICULTY_LABELS: Record<BotDifficulty, string> = {
  1: 'Beginner',
  2: 'Casual',
  3: 'Intermediate',
  4: 'Advanced',
  5: 'Master',
};

export default function App(): React.ReactElement {
  // ── Mode ──
  const [mode, setMode] = useState<AppMode>('coach');

  const [status, setStatus] = useState<StatusUpdate>({
    status: 'idle',
    message: 'Play a move or ask for a hint',
  });
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
  const [playerColor, setPlayerColor] = useState<'white' | 'black'>('white');
  const [isBotThinking, setIsBotThinking] = useState(false);

  // ── Modeler mode state ──
  const [autoAnalyze, setAutoAnalyze] = useState(true);

  // Track the FEN from before the last move (for evaluation)
  const pendingHintRef = useRef<HintResult | null>(null);
  const cleanupRef = useRef<(() => void)[]>([]);

  // Ref to trigger bot move from the board component
  const triggerBotMoveRef = useRef<
    ((moveUci: string, moveSan: string) => void) | null
  >(null);

  useEffect(() => {
    const unsubStatus = window.chessHelper.onStatusUpdate((update) => {
      setStatus(update);
    });
    cleanupRef.current = [unsubStatus];
    return () => {
      cleanupRef.current.forEach((fn) => fn());
    };
  }, []);

  // ── Mode switching ──
  const handleModeChange = useCallback(
    (newMode: AppMode) => {
      if (newMode === mode) return;
      setMode(newMode);
      // Reset shared state
      setHint(null);
      setMoveEvaluation(null);
      setError(null);
      setGameOver(false);
      setIsBotThinking(false);
      pendingHintRef.current = null;
      // Reset board to starting position
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
        const result = await window.chessHelper.getBotMove(fen, difficulty);
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
    [difficulty, mode],
  );

  // ── Hint (coach mode) ──
  const handleRequestHint = useCallback(async () => {
    setIsThinking(true);
    setError(null);
    setMoveEvaluation(null);

    try {
      const result = await window.chessHelper.getHint(currentFen);
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
  }, [currentFen]);

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

      // ── Modeler mode: just update FEN (analysis is triggered via useEffect in ModelerPanel)
      if (mode === 'modeler') {
        return;
      }

      // ── Coach mode ──
      if (!info.isUserMove) return;

      // Evaluate if hint was pending
      if (pendingHintRef.current) {
        setIsThinking(true);
        setHint(null);
        try {
          const result = await window.chessHelper.evaluateMove(
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

      // Bot responds
      setTimeout(() => {
        requestBotMove(info.fenAfter);
      }, 300);
    },
    [mode, requestBotMove],
  );

  // ── Reset ──
  const handleReset = useCallback(() => {
    setCurrentFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    setHint(null);
    setMoveEvaluation(null);
    setError(null);
    setGameOver(false);
    setIsBotThinking(false);
    pendingHintRef.current = null;

    if (mode === 'coach' && playerColor === 'black') {
      setTimeout(() => {
        requestBotMove(
          'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        );
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

  const handleToggleAutoAnalyze = useCallback(() => {
    setAutoAnalyze((v) => !v);
  }, []);

  const sideToMove = currentFen.split(' ')[1] === 'w' ? 'white' : 'black';
  const isPlayerTurn = sideToMove === playerColor;

  return (
    <div className="app-container">
      {/* Title bar */}
      <div className="title-bar drag-region">
        <span className="title-icon">♟</span>
        <span className="title-text">Chess Helper</span>
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
                >
                  {d}
                </button>
              ))}
            </div>
            <span className="difficulty-label">
              {DIFFICULTY_LABELS[difficulty]}
            </span>
          </div>
          <div className="color-selector">
            <span className="settings-label">Play as</span>
            <div className="color-buttons">
              <button
                className={`color-btn ${playerColor === 'white' ? 'color-btn--active' : ''}`}
                onClick={() => handleColorChange('white')}
                title="Play as White"
              >
                ♔
              </button>
              <button
                className={`color-btn ${playerColor === 'black' ? 'color-btn--active' : ''}`}
                onClick={() => handleColorChange('black')}
                title="Play as Black"
              >
                ♚
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scrollable content area */}
      <div className="app-scroll-area">
        {/* Interactive board */}
        <InteractiveBoard
          mode={mode}
          onMoveMade={handleMoveMade}
          onReset={handleReset}
          onGameOver={handleGameOver}
          boardWidth={280}
          hint={hint}
          moveEvaluation={moveEvaluation}
          isThinking={isThinking || isBotThinking}
          playerColor={playerColor}
          isBotThinking={isBotThinking}
          triggerBotMoveRef={triggerBotMoveRef}
        />

        {/* FEN input */}
        {showFenInput && (
          <FenInput
            currentFen={currentFen}
            onSubmit={handleFenSubmit}
            onClose={() => setShowFenInput(false)}
          />
        )}

        {/* Mode-specific panel */}
        <div className="content">
          {mode === 'coach' ? (
            <CoachingPanel
              hint={hint}
              moveEvaluation={moveEvaluation}
              isThinking={isThinking}
              isBotThinking={isBotThinking}
              onRequestHint={handleRequestHint}
              canRequestHint={
                !isThinking && !gameOver && !isBotThinking && isPlayerTurn
              }
              gameOver={gameOver}
              error={error}
              onDismissEvaluation={handleDismissEvaluation}
            />
          ) : (
            <ModelerPanel
              currentFen={currentFen}
              autoAnalyze={autoAnalyze}
              onToggleAutoAnalyze={handleToggleAutoAnalyze}
            />
          )}
        </div>
      </div>
    </div>
  );
}
