import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnalyzedMove, PositionAnalysis } from '../../shared/types';

interface ModelerPanelProps {
  /** Current FEN to analyze */
  currentFen: string;
  /** Whether auto-analyze is enabled (analyze after each move) */
  autoAnalyze: boolean;
  /** Toggle auto-analyze on/off */
  onToggleAutoAnalyze: () => void;
}

function formatEval(move: AnalyzedMove): { text: string; className: string } {
  if (move.mateIn !== null) {
    const abs = Math.abs(move.mateIn);
    if (move.mateIn > 0) {
      return { text: `M${abs}`, className: 'modeler-eval--mate-win' };
    }
    return { text: `-M${abs}`, className: 'modeler-eval--mate-lose' };
  }

  if (move.scoreCp === null)
    return { text: '?', className: 'modeler-eval--equal' };

  const pawns = move.scoreCp / 100;
  const sign = pawns >= 0 ? '+' : '';
  const text = `${sign}${pawns.toFixed(1)}`;

  if (pawns > 2) return { text, className: 'modeler-eval--winning' };
  if (pawns > 0.5) return { text, className: 'modeler-eval--advantage' };
  if (pawns > -0.5) return { text, className: 'modeler-eval--equal' };
  if (pawns > -2) return { text, className: 'modeler-eval--disadvantage' };
  return { text, className: 'modeler-eval--losing' };
}

export function ModelerPanel({
  currentFen,
  autoAnalyze,
  onToggleAutoAnalyze,
}: ModelerPanelProps): React.ReactElement {
  const [analysis, setAnalysis] = useState<PositionAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const lastFenRef = useRef<string>('');

  const runAnalysis = useCallback(async (fen: string) => {
    setIsAnalyzing(true);
    setExpandedIdx(null);
    try {
      const result = await window.chessHelper.analyzePosition(fen);
      setAnalysis(result);
    } catch (err) {
      setAnalysis({
        fen,
        moves: [],
        error: String(err),
      });
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  // Auto-analyze when FEN changes (if enabled)
  useEffect(() => {
    if (autoAnalyze && currentFen !== lastFenRef.current) {
      lastFenRef.current = currentFen;
      runAnalysis(currentFen);
    }
  }, [currentFen, autoAnalyze, runAnalysis]);

  const handleManualAnalyze = useCallback(() => {
    lastFenRef.current = currentFen;
    runAnalysis(currentFen);
  }, [currentFen, runAnalysis]);

  const toggleExpand = useCallback((idx: number) => {
    setExpandedIdx((prev) => (prev === idx ? null : idx));
  }, []);

  return (
    <div className="modeler-panel">
      {/* Controls */}
      <div className="modeler-controls">
        <button
          className="modeler-analyze-btn"
          onClick={handleManualAnalyze}
          disabled={isAnalyzing}
        >
          {isAnalyzing ? '⏳ Analyzing…' : '🔍 Analyze Position'}
        </button>
        <label className="modeler-auto-toggle">
          <input
            type="checkbox"
            checked={autoAnalyze}
            onChange={onToggleAutoAnalyze}
          />
          <span>Auto</span>
        </label>
      </div>

      {/* Analysis spinner */}
      {isAnalyzing && (
        <div className="modeler-thinking">
          <div className="coaching-spinner"></div>
          <span>Analyzing position…</span>
        </div>
      )}

      {/* Error */}
      {analysis?.error && !isAnalyzing && (
        <div className="modeler-error">
          <span className="coaching-error-icon">⚠</span>
          <p>{analysis.error}</p>
        </div>
      )}

      {/* Move list */}
      {analysis && analysis.moves.length > 0 && !isAnalyzing && (
        <div className="modeler-moves">
          <div className="modeler-moves-header">
            <span className="modeler-col-rank">#</span>
            <span className="modeler-col-move">Move</span>
            <span className="modeler-col-eval">Eval</span>
          </div>
          <div className="modeler-moves-list">
            {analysis.moves.map((move, idx) => {
              const evalInfo = formatEval(move);
              const isExpanded = expandedIdx === idx;
              return (
                <div key={idx}>
                  <button
                    className={`modeler-move-row ${idx === 0 ? 'modeler-move-row--best' : ''} ${isExpanded ? 'modeler-move-row--expanded' : ''}`}
                    onClick={() => toggleExpand(idx)}
                    title={move.description}
                  >
                    <span className="modeler-col-rank">{idx + 1}</span>
                    <span className="modeler-col-move">
                      {move.san}
                      {idx === 0 && (
                        <span className="modeler-best-badge">Best</span>
                      )}
                    </span>
                    <span className={`modeler-col-eval ${evalInfo.className}`}>
                      {evalInfo.text}
                    </span>
                    <span className="modeler-expand-icon">
                      {isExpanded ? '▾' : '▸'}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="modeler-move-detail">
                      <p className="modeler-move-description">
                        {move.description}
                      </p>
                      {move.pv && move.pv.length > 1 && (
                        <p className="modeler-move-pv">
                          <span className="modeler-pv-label">Line: </span>
                          {move.pv.slice(0, 6).join(' ')}
                          {move.pv.length > 6 ? ' …' : ''}
                        </p>
                      )}
                      <p className="modeler-move-depth">Depth: {move.depth}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!analysis && !isAnalyzing && (
        <div className="modeler-empty">
          <p>
            Set up a position on the board, then analyze to see the best moves
            with explanations.
          </p>
        </div>
      )}
    </div>
  );
}
