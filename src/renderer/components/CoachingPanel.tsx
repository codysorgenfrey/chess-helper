import React from 'react';
import { HintResult, MoveEvaluation, MoveQuality } from '../../shared/types';

interface CoachingPanelProps {
  /** Current coaching hint, if any */
  hint: HintResult | null;
  /** Evaluation of the last user move, if any */
  moveEvaluation: MoveEvaluation | null;
  /** Whether the engine is currently thinking (hint/eval) */
  isThinking: boolean;
  /** Whether the bot is currently computing its move */
  isBotThinking: boolean;
  /** Callback to request a hint */
  onRequestHint: () => void;
  /** Whether a hint can be requested (e.g., it's the user's turn) */
  canRequestHint: boolean;
  /** Whether the game is over */
  gameOver: boolean;
  /** Error message to display */
  error: string | null;
  /** Dismiss the evaluation to clear the panel */
  onDismissEvaluation: () => void;
}

const qualityConfig: Record<
  MoveQuality,
  { icon: string; className: string; label: string }
> = {
  best: { icon: '★', className: 'quality--best', label: 'Best Move!' },
  excellent: { icon: '✦', className: 'quality--excellent', label: 'Excellent' },
  good: { icon: '✓', className: 'quality--good', label: 'Good Move' },
  inaccuracy: {
    icon: '?!',
    className: 'quality--inaccuracy',
    label: 'Inaccuracy',
  },
  mistake: { icon: '?', className: 'quality--mistake', label: 'Mistake' },
  blunder: { icon: '??', className: 'quality--blunder', label: 'Blunder' },
};

export function CoachingPanel({
  hint,
  moveEvaluation,
  isThinking,
  isBotThinking,
  onRequestHint,
  canRequestHint,
  gameOver,
  error,
  onDismissEvaluation,
}: CoachingPanelProps): React.ReactElement {
  // Build independent sections that compose together

  const evalSection = moveEvaluation
    ? (() => {
        const config = qualityConfig[moveEvaluation.quality];
        return (
          <div className={`coaching-eval ${config.className}`}>
            <div className="coaching-eval-header">
              <span className="coaching-eval-icon">{config.icon}</span>
              <span className="coaching-eval-label">{config.label}</span>
              <span className="coaching-eval-move">
                {moveEvaluation.userMoveSan}
              </span>
              <button
                className="coaching-dismiss-btn"
                onClick={onDismissEvaluation}
                title="Dismiss"
              >
                ✕
              </button>
            </div>
            <p className="coaching-eval-explanation">
              {moveEvaluation.explanation}
            </p>
          </div>
        );
      })()
    : null;

  // Game over state — replaces the hint area entirely
  if (gameOver) {
    return (
      <div className="coaching-panel">
        {evalSection}
        <div className="coaching-game-over">
          <span className="coaching-game-over-icon">🏁</span>
          <p>Game over! Reset the board to play again.</p>
        </div>
      </div>
    );
  }

  // Error display
  const errorSection = error ? (
    <div className="coaching-error">
      <span className="coaching-error-icon">⚠</span>
      <p>{error}</p>
    </div>
  ) : null;

  // Thinking / hint / hint-button section
  let hintSection: React.ReactNode = null;
  if (isThinking) {
    hintSection = (
      <div className="coaching-thinking">
        <div className="coaching-spinner"></div>
        <span>Analyzing position…</span>
      </div>
    );
  } else if (isBotThinking) {
    hintSection = (
      <div className="coaching-thinking">
        <div className="coaching-spinner"></div>
        <span>Opponent is thinking…</span>
      </div>
    );
  } else if (hint) {
    hintSection = (
      <>
        <div className="coaching-hint">
          <div className="coaching-hint-header">
            <span className="coaching-hint-icon">💡</span>
            <span className="coaching-hint-label">Hint</span>
          </div>
          <p className="coaching-hint-text">{hint.coachingHint}</p>
        </div>
        <p className="coaching-hint-subtext">
          Make your move — I'll tell you how it compares!
        </p>
      </>
    );
  } else {
    hintSection = (
      <div className="coaching-ready">
        <p className="coaching-prompt">Need help finding the best move?</p>
        <button
          className="coaching-hint-btn"
          onClick={onRequestHint}
          disabled={!canRequestHint}
          title="Get a coaching hint"
        >
          💡 Give me a hint
        </button>
      </div>
    );
  }

  return (
    <div className="coaching-panel">
      {evalSection}
      {errorSection}
      {hintSection}
    </div>
  );
}
