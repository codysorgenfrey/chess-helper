import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CalibrationData } from '../../shared/types';

type WizardPhase =
  | 'idle'
  | 'loading'
  | 'selecting'
  | 'confirming'
  | 'saving'
  | 'done'
  | 'error';

interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  onComplete: (data: CalibrationData) => void;
  onCancel: () => void;
}

export function CalibrationWizard({
  onComplete,
  onCancel,
}: Props): React.ReactElement {
  const [phase, setPhase] = useState<WizardPhase>('idle');
  const [boardDataUrl, setBoardDataUrl] = useState<string>('');
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string>('');
  const [isFlipped, setIsFlipped] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Selection rectangle state
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const selectImgRef = useRef<HTMLImageElement>(null);
  const cleanupRef = useRef<(() => void)[]>([]);

  // Subscribe to IPC events from main
  useEffect(() => {
    const unsubScreenshot = window.chessHelper.calibration.onScreenshot(
      (payload) => {
        setScreenshotDataUrl(payload.screenshotDataUrl);
        setSelection(null);
        setPhase('selecting');
      },
    );

    const unsubInit = window.chessHelper.calibration.onInit((payload) => {
      setBoardDataUrl(payload.boardImageDataUrl);
      setPhase('confirming');
    });

    const unsubComplete = window.chessHelper.calibration.onComplete(
      (data: CalibrationData) => {
        setPhase('done');
        // Auto-close after 1.2 s
        setTimeout(() => onComplete(data), 1200);
      },
    );

    const unsubError = window.chessHelper.calibration.onError((e) => {
      setErrorMsg(e.message);
      setPhase('error');
    });

    cleanupRef.current = [
      unsubScreenshot,
      unsubInit,
      unsubComplete,
      unsubError,
    ];
    return () => {
      cleanupRef.current.forEach((fn) => fn());
    };
  }, [onComplete]);

  const handleStart = useCallback(async () => {
    setPhase('loading');
    setErrorMsg('');
    setSelection(null);
    setIsFlipped(false);
    try {
      await window.chessHelper.calibration.start();
      // Phase will be set to 'selecting' via onScreenshot event
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, []);

  const handleCancel = useCallback(async () => {
    window.chessHelper.calibration.cancel().catch(() => {
      /* ignore */
    });
    onCancel();
  }, [onCancel]);

  // ── Selection rectangle mouse handlers ──────────────────────────────────────

  const handleSelectMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!selectImgRef.current) return;
      const rect = selectImgRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      dragStart.current = { x, y };
      setSelection({ x, y, width: 0, height: 0 });
      setIsDragging(true);
    },
    [],
  );

  const handleSelectMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isDragging || !dragStart.current || !selectImgRef.current) return;
      const rect = selectImgRef.current.getBoundingClientRect();
      const curX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const curY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

      const x = Math.min(dragStart.current.x, curX);
      const y = Math.min(dragStart.current.y, curY);
      const width = Math.abs(curX - dragStart.current.x);
      const height = Math.abs(curY - dragStart.current.y);
      setSelection({ x, y, width, height });
    },
    [isDragging],
  );

  const handleSelectMouseUp = useCallback(() => {
    setIsDragging(false);
    dragStart.current = null;
  }, []);

  const handleConfirmRegion = useCallback(async () => {
    if (!selection || !selectImgRef.current) return;
    if (selection.width < 10 || selection.height < 10) {
      setErrorMsg('Please draw a larger rectangle around the board.');
      setPhase('error');
      return;
    }

    const rect = selectImgRef.current.getBoundingClientRect();
    setPhase('loading');
    try {
      await window.chessHelper.calibration.confirmRegion({
        x: selection.x,
        y: selection.y,
        width: selection.width,
        height: selection.height,
        displayWidth: rect.width,
        displayHeight: rect.height,
      });
      // Phase will be set to 'confirming' via onInit event
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, [selection]);

  const handleConfirmStarting = useCallback(async () => {
    setPhase('saving');
    try {
      await window.chessHelper.calibration.save(isFlipped);
      // Phase will be set to 'done' via onComplete event
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, [isFlipped]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="wizard-container">
      {/* Header */}
      <div className="wizard-header">
        <span className="wizard-title-icon">🎯</span>
        <span className="wizard-title">Calibration Wizard</span>
      </div>

      {/* idle phase */}
      {phase === 'idle' && (
        <div className="wizard-body">
          <p className="wizard-intro">
            To recognise pieces, Chess Helper needs a snapshot of the{' '}
            <strong>starting position</strong>.
          </p>
          <p className="wizard-intro wizard-intro--secondary">
            Open a new game on your chess site so the board shows the initial
            setup, then click <em>Start</em>. You'll draw a rectangle around the
            board and confirm the orientation — that's it!
          </p>
          <div className="wizard-actions">
            <button className="btn-primary" onClick={handleStart}>
              Start Calibration
            </button>
            <button className="btn-secondary" onClick={handleCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* loading phase */}
      {phase === 'loading' && (
        <div className="wizard-body wizard-body--center">
          <div className="spinner"></div>
          <span className="wizard-status-text">Working…</span>
        </div>
      )}

      {/* selecting phase — user draws a rectangle around the board */}
      {phase === 'selecting' && screenshotDataUrl && (
        <div className="wizard-body wizard-body--clicking">
          <p className="wizard-instruction">
            Click and drag to draw a rectangle around the chess board, then
            click Confirm.
          </p>

          <div
            className="wizard-select-container"
            onMouseDown={handleSelectMouseDown}
            onMouseMove={handleSelectMouseMove}
            onMouseUp={handleSelectMouseUp}
            onMouseLeave={handleSelectMouseUp}
          >
            <img
              ref={selectImgRef}
              src={screenshotDataUrl}
              alt="Full screenshot — draw a rectangle around the board"
              className="wizard-board-img"
              draggable={false}
            />
            {selection && selection.width > 0 && selection.height > 0 && (
              <div
                className="wizard-selection-rect"
                style={{
                  left: selection.x,
                  top: selection.y,
                  width: selection.width,
                  height: selection.height,
                }}
              />
            )}
          </div>

          <div className="wizard-actions">
            <button
              className="btn-primary"
              onClick={handleConfirmRegion}
              disabled={
                !selection || selection.width < 10 || selection.height < 10
              }
            >
              Confirm Selection
            </button>
            <button className="btn-secondary" onClick={handleCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* confirming phase — user confirms starting position + orientation */}
      {phase === 'confirming' && boardDataUrl && (
        <div className="wizard-body wizard-body--clicking">
          <p className="wizard-instruction">
            Confirm this is the <strong>starting position</strong> and select
            which colour is at the bottom of the board.
          </p>

          <img
            src={boardDataUrl}
            alt="Cropped board — confirm starting position"
            className="wizard-board-img"
            draggable={false}
          />

          <div className="wizard-orientation">
            <label className="wizard-radio">
              <input
                type="radio"
                name="orientation"
                checked={!isFlipped}
                onChange={() => setIsFlipped(false)}
              />
              <span>♔ White at bottom</span>
            </label>
            <label className="wizard-radio">
              <input
                type="radio"
                name="orientation"
                checked={isFlipped}
                onChange={() => setIsFlipped(true)}
              />
              <span>♚ Black at bottom</span>
            </label>
          </div>

          <div className="wizard-actions">
            <button className="btn-primary" onClick={handleConfirmStarting}>
              Confirm &amp; Save
            </button>
            <button className="btn-secondary" onClick={handleCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* saving phase */}
      {phase === 'saving' && (
        <div className="wizard-body wizard-body--center">
          <div className="spinner"></div>
          <span className="wizard-status-text">
            Extracting piece templates…
          </span>
        </div>
      )}

      {/* done phase */}
      {phase === 'done' && (
        <div className="wizard-body wizard-body--center">
          <span className="wizard-done-icon">✓</span>
          <span className="wizard-status-text wizard-status-text--success">
            Calibration complete!
          </span>
        </div>
      )}

      {/* error phase */}
      {phase === 'error' && (
        <div className="wizard-body">
          <div className="wizard-error-icon">⚠</div>
          <p className="wizard-error-text">{errorMsg}</p>
          <div className="wizard-actions">
            <button className="btn-primary" onClick={handleStart}>
              Retry
            </button>
            <button className="btn-secondary" onClick={handleCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
