import React, { useState, useRef } from 'react';

interface FenInputProps {
  currentFen: string;
  onSubmit: (fen: string) => void;
  onClose: () => void;
}

export function FenInput({ currentFen, onSubmit, onClose }: FenInputProps): React.ReactElement {
  const [fen, setFen] = useState(currentFen);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = fen.trim();
    if (!trimmed) {
      setError('Please enter a FEN string');
      return;
    }

    // Basic FEN validation (8 ranks separated by /)
    const parts = trimmed.split(' ');
    const ranks = parts[0]?.split('/') ?? [];
    if (ranks.length !== 8) {
      setError('Invalid FEN: must have 8 ranks separated by /');
      return;
    }

    setError('');
    onSubmit(trimmed);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // Auto-submit on paste if it looks like a FEN
    const pasted = e.clipboardData.getData('text').trim();
    if (pasted.split('/').length === 8 || pasted.includes(' fen ')) {
      setTimeout(() => {
        setFen(pasted);
      }, 0);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="fen-input-container">
      <div className="fen-input-header">
        <span>Enter FEN Position</span>
        <button className="btn-icon btn-close" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <form onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          className={`fen-textarea ${error ? 'fen-textarea--error' : ''}`}
          value={fen}
          onChange={(e) => {
            setFen(e.target.value);
            setError('');
          }}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          placeholder="rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"
          rows={3}
          spellCheck={false}
          autoFocus
        />
        {error && <div className="fen-error">{error}</div>}

        <div className="fen-input-actions">
          <button type="submit" className="btn-primary btn-sm">
            Analyze
          </button>
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>

      <div className="fen-hint">
        Tip: Copy the FEN from Lichess Analysis or Chess.com Analysis board
      </div>
    </div>
  );
}
