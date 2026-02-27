import React, { useRef, useEffect, useState, useCallback } from 'react';
import { ChatMessage, MoveEvaluation, MoveQuality } from '../../shared/types';

/* ── Quality display config ── */

const qualityConfig: Record<
  MoveQuality,
  { icon: string; className: string; label: string }
> = {
  best: { icon: '★', className: 'quality--best', label: 'Best Move!' },
  excellent: {
    icon: '✦',
    className: 'quality--excellent',
    label: 'Excellent',
  },
  good: { icon: '✓', className: 'quality--good', label: 'Good Move' },
  inaccuracy: {
    icon: '?!',
    className: 'quality--inaccuracy',
    label: 'Inaccuracy',
  },
  mistake: { icon: '?', className: 'quality--mistake', label: 'Mistake' },
  blunder: { icon: '??', className: 'quality--blunder', label: 'Blunder' },
};

/* ── Props ── */

interface CoachingPanelProps {
  messages: ChatMessage[];
  isThinking: boolean;
  isBotThinking: boolean;
  onRequestHint: () => void;
  onExplainMove: (evaluation: MoveEvaluation) => void;
  onSendMessage: (text: string) => void;
  canRequestHint: boolean;
  gameOver: boolean;
  error: string | null;
}

/* ── Individual message renderers ── */

function SystemMessage({ msg }: { msg: ChatMessage }) {
  return (
    <div className="chat-msg chat-msg--system">
      <span className="chat-msg-text">{msg.text}</span>
    </div>
  );
}

function UserMoveMessage({
  msg,
  onExplain,
}: {
  msg: ChatMessage;
  onExplain: (evaluation: MoveEvaluation) => void;
}) {
  const evaluation = msg.moveEvaluation;
  const config = evaluation ? qualityConfig[evaluation.quality] : null;

  return (
    <div
      className={`chat-msg chat-msg--user-move${config ? ` ${config.className}` : ''}`}
    >
      <div className="chat-user-move-row">
        <span className="chat-msg-icon">♟</span>
        <span className="chat-msg-text">
          You played <strong>{msg.moveSan}</strong>
        </span>
        {config && (
          <span className="chat-user-move-quality">
            <span className="chat-eval-icon">{config.icon}</span>
            <span className="chat-eval-label">{config.label}</span>
          </span>
        )}
      </div>
      {evaluation && evaluation.quality !== 'best' && (
        <div className="chat-user-move-details">
          <span className="chat-eval-best">
            Best: <strong>{evaluation.bestMoveSan}</strong>
          </span>
          <button
            className="chat-explain-btn"
            onClick={() => onExplain(evaluation)}
            title="Ask the AI coach to explain this evaluation"
          >
            🧠 Explain
          </button>
        </div>
      )}
      {evaluation && evaluation.quality === 'best' && (
        <div className="chat-user-move-details">
          <button
            className="chat-explain-btn"
            onClick={() => onExplain(evaluation)}
            title="Ask the AI coach to explain this evaluation"
          >
            🧠 Explain
          </button>
        </div>
      )}
    </div>
  );
}

function BotMoveMessage({ msg }: { msg: ChatMessage }) {
  return (
    <div className="chat-msg chat-msg--bot-move">
      <span className="chat-msg-icon">🤖</span>
      <span className="chat-msg-text">
        Opponent played <strong>{msg.moveSan}</strong>
      </span>
    </div>
  );
}

function EvaluationMessage({
  msg,
  onExplain,
}: {
  msg: ChatMessage;
  onExplain: (evaluation: MoveEvaluation) => void;
}) {
  const evaluation = msg.moveEvaluation;
  if (!evaluation) return null;

  const config = qualityConfig[evaluation.quality];
  const cpLoss = evaluation.centipawnLoss;
  const scoreStr =
    evaluation.userMoveScoreCp !== null
      ? `${(evaluation.userMoveScoreCp / 100).toFixed(1)}`
      : evaluation.userMoveMateIn !== null
        ? `M${Math.abs(evaluation.userMoveMateIn)}`
        : '?';

  return (
    <div className={`chat-msg chat-msg--evaluation ${config.className}`}>
      <div className="chat-eval-header">
        <span className="chat-eval-icon">{config.icon}</span>
        <span className="chat-eval-label">{config.label}</span>
        <span className="chat-eval-move">{evaluation.userMoveSan}</span>
      </div>
      <div className="chat-eval-stats">
        <span className="chat-eval-stat">
          Eval: <strong>{scoreStr}</strong>
        </span>
        {cpLoss > 0 && (
          <span className="chat-eval-stat">
            Loss: <strong>{cpLoss}</strong> cp
          </span>
        )}
        {evaluation.quality !== 'best' && (
          <span className="chat-eval-stat chat-eval-best">
            Best: <strong>{evaluation.bestMoveSan}</strong>
          </span>
        )}
      </div>
      <button
        className="chat-explain-btn"
        onClick={() => onExplain(evaluation)}
        title="Ask the AI coach to explain this evaluation"
      >
        🧠 Explain this
      </button>
    </div>
  );
}

function HintMessage({ msg }: { msg: ChatMessage }) {
  return (
    <div className="chat-msg chat-msg--hint">
      <div className="chat-hint-header">
        <span className="chat-msg-icon">💡</span>
        <span className="chat-hint-label">Hint</span>
      </div>
      <p className="chat-hint-text">{msg.text}</p>
    </div>
  );
}

function ExplanationMessage({ msg }: { msg: ChatMessage }) {
  return (
    <div className="chat-msg chat-msg--ai">
      <div className="chat-ai-header">
        <span className="chat-msg-icon">🧠</span>
        <span className="chat-ai-label">Coach</span>
      </div>
      <p className="chat-ai-text">{msg.text}</p>
    </div>
  );
}

function UserQuestionMessage({ msg }: { msg: ChatMessage }) {
  return (
    <div className="chat-msg chat-msg--user-question">
      <p className="chat-user-text">{msg.text}</p>
    </div>
  );
}

function AIResponseMessage({ msg }: { msg: ChatMessage }) {
  return (
    <div className="chat-msg chat-msg--ai">
      <div className="chat-ai-header">
        <span className="chat-msg-icon">🧠</span>
        <span className="chat-ai-label">Coach</span>
      </div>
      <p className="chat-ai-text">{msg.text}</p>
    </div>
  );
}

/* ── Message Router ── */

function ChatMessageItem({
  msg,
  onExplain,
}: {
  msg: ChatMessage;
  onExplain: (evaluation: MoveEvaluation) => void;
}) {
  switch (msg.type) {
    case 'system':
      return <SystemMessage msg={msg} />;
    case 'user-move':
      return <UserMoveMessage msg={msg} onExplain={onExplain} />;
    case 'bot-move':
      return <BotMoveMessage msg={msg} />;
    case 'evaluation':
      return null; // evaluations are now shown inline on user-move
    case 'hint':
      return <HintMessage msg={msg} />;
    case 'explanation':
      return <ExplanationMessage msg={msg} />;
    case 'user-question':
      return <UserQuestionMessage msg={msg} />;
    case 'ai-response':
      return <AIResponseMessage msg={msg} />;
    case 'thinking':
      return null; // handled inline below
    default:
      return null;
  }
}

/* ── Main Component ── */

export function CoachingPanel({
  messages,
  isThinking,
  isBotThinking,
  onRequestHint,
  onExplainMove,
  onSendMessage,
  canRequestHint,
  gameOver,
  error,
}: CoachingPanelProps): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState('');

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isThinking, isBotThinking]);

  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setInputValue('');
    inputRef.current?.focus();
  }, [inputValue, onSendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="chat-panel">
      {/* Scrollable message list */}
      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 && !isThinking && !isBotThinking && (
          <div className="chat-empty">
            <p className="chat-empty-text">
              {gameOver
                ? '🏁 Game over! Reset the board to play again.'
                : 'Make a move or ask for a hint to get started.'}
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <ChatMessageItem key={msg.id} msg={msg} onExplain={onExplainMove} />
        ))}

        {/* Live thinking indicators */}
        {isThinking && (
          <div className="chat-msg chat-msg--thinking">
            <div className="coaching-spinner" />
            <span className="chat-msg-text">Analyzing…</span>
          </div>
        )}
        {isBotThinking && (
          <div className="chat-msg chat-msg--thinking">
            <div className="coaching-spinner" />
            <span className="chat-msg-text">Opponent is thinking…</span>
          </div>
        )}

        {error && (
          <div className="chat-msg chat-msg--error">
            <span className="chat-msg-icon">⚠</span>
            <span className="chat-msg-text">{error}</span>
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="chat-input-area">
        <button
          className="chat-hint-btn"
          onClick={onRequestHint}
          disabled={!canRequestHint}
          title="Get a coaching hint"
        >
          💡
        </button>
        <input
          ref={inputRef}
          className="chat-input"
          type="text"
          placeholder="Ask a question…"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isThinking}
        />
        <button
          className="chat-send-btn"
          onClick={handleSend}
          disabled={!inputValue.trim() || isThinking}
          title="Send"
        >
          ➤
        </button>
      </div>
    </div>
  );
}
