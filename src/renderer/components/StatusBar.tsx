import React from 'react';
import { StatusUpdate } from '../../shared/types';

interface StatusBarProps {
  status: StatusUpdate;
  isLoading: boolean;
  sideToMove: 'w' | 'b';
  onToggleSide: (side: 'w' | 'b') => void;
  onCapture: () => void;
  confidence: number | null;
}

export function StatusBar({
  status,
  isLoading,
  sideToMove,
  onToggleSide,
  onCapture,
  confidence,
}: StatusBarProps): React.ReactElement {
  const statusClass = getStatusClass(status.status);

  return (
    <div className="status-bar">
      {/* Status indicator */}
      <div className={`status-indicator ${statusClass}`}>
        <span className="status-dot" />
        <span className="status-text">{status.message}</span>
      </div>

      {/* Controls row */}
      <div className="status-controls">
        {/* Side to move toggle */}
        <div className="side-toggle" title="Side to move">
          <button
            className={`side-btn ${sideToMove === 'w' ? 'side-btn--active' : ''}`}
            onClick={() => onToggleSide('w')}
            aria-pressed={sideToMove === 'w'}
            title="White to move"
          >
            <span className="color-icon color-icon--white" /> W
          </button>
          <button
            className={`side-btn ${sideToMove === 'b' ? 'side-btn--active' : ''}`}
            onClick={() => onToggleSide('b')}
            aria-pressed={sideToMove === 'b'}
            title="Black to move"
          >
            <span className="color-icon color-icon--black" /> B
          </button>
        </div>

        {/* Confidence badge */}
        {confidence !== null && (
          <span
            className={`confidence-badge ${getConfidenceClass(confidence)}`}
            title="Board detection confidence"
          >
            {Math.round(confidence * 100)}%
          </span>
        )}

        {/* Refresh button */}
        <button
          className="btn-icon btn-refresh"
          onClick={onCapture}
          disabled={isLoading}
          title="Re-analyze board (⌘⇧C)"
          aria-label="Analyze board"
        >
          {isLoading ? '⟳' : '↺'}
        </button>
      </div>
    </div>
  );
}

function getStatusClass(statusType: string): string {
  switch (statusType) {
    case 'idle':
      return 'status--idle';
    case 'capturing':
    case 'detecting':
    case 'classifying':
    case 'analyzing':
      return 'status--working';
    case 'done':
      return 'status--done';
    case 'error':
      return 'status--error';
    default:
      return 'status--idle';
  }
}

function getConfidenceClass(confidence: number): string {
  if (confidence >= 0.8) return 'confidence--high';
  if (confidence >= 0.6) return 'confidence--medium';
  return 'confidence--low';
}
