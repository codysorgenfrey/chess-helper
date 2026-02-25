import React, { useEffect, useRef, useState, useCallback } from 'react';
import { AnalysisResult, StatusUpdate } from '../shared/types';
import { MoveList } from './components/MoveList';
import { FenInput } from './components/FenInput';
import { InteractiveBoard } from './components/InteractiveBoard';

export default function App(): React.ReactElement {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [status, setStatus] = useState<StatusUpdate>({
    status: 'idle',
    message: 'Make a move to analyze',
  });
  const [showFenInput, setShowFenInput] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const cleanupRef = useRef<(() => void)[]>([]);

  useEffect(() => {
    // Subscribe to analysis updates
    const unsubAnalysis = window.chessHelper.onAnalysisUpdate((result) => {
      setAnalysis(result);
      setIsLoading(false);
    });

    // Subscribe to status updates
    const unsubStatus = window.chessHelper.onStatusUpdate((update) => {
      setStatus(update);
      if (update.status === 'analyzing') {
        setIsLoading(true);
      } else {
        setIsLoading(false);
      }
    });

    cleanupRef.current = [unsubAnalysis, unsubStatus];
    return () => {
      cleanupRef.current.forEach((fn) => fn());
    };
  }, []);

  const handleFenSubmit = useCallback(async (fen: string) => {
    setIsLoading(true);
    try {
      await window.chessHelper.setFenManual(fen);
      setShowFenInput(false);
    } catch (err) {
      setIsLoading(false);
      setStatus({ status: 'error', message: String(err) });
    }
  }, []);

  const showFenToggle = useCallback(() => {
    setShowFenInput((v) => !v);
  }, []);

  // Handler for interactive board position changes
  const handleBoardPositionChange = useCallback(async (fen: string) => {
    setIsLoading(true);
    try {
      await window.chessHelper.setFenManual(fen);
    } catch (err) {
      setIsLoading(false);
      setStatus({ status: 'error', message: String(err) });
    }
  }, []);

  // ── Normal mode ────────────────────────────────────────────────────────────
  return (
    <div className="app-container">
      {/* Drag handle / title bar */}
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

      {/* Interactive board – primary input */}
      <InteractiveBoard
        onPositionChange={handleBoardPositionChange}
        boardWidth={280}
      />

      {/* FEN input (shown on user request) */}
      {showFenInput && (
        <FenInput
          currentFen={analysis?.fen ?? ''}
          onSubmit={handleFenSubmit}
          onClose={() => setShowFenInput(false)}
        />
      )}

      {/* Analysis results */}
      <div className="content">
        {analysis?.error && !analysis.moves.length ? (
          <div className="error-message">
            <span className="error-icon">⚠</span>
            <p>{analysis.error}</p>
          </div>
        ) : analysis?.moves && analysis.moves.length > 0 ? (
          <MoveList moves={analysis.moves} />
        ) : null}

        {isLoading && (
          <div className="loading-overlay">
            <div className="spinner"></div>
            <span>{status.message}</span>
          </div>
        )}
      </div>
    </div>
  );
}
