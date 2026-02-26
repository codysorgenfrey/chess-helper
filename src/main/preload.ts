import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/constants';
import {
  AnalysisResult,
  AppSettings,
  BotDifficulty,
  BotMoveResult,
  CalibrationConfirmRegionPayload,
  CalibrationData,
  CalibrationInitPayload,
  CalibrationScreenshotPayload,
  HintResult,
  MoveEvaluation,
  PositionAnalysis,
  StatusUpdate,
} from '../shared/types';

// Expose a minimal, type-safe API to the renderer
contextBridge.exposeInMainWorld('chessHelper', {
  triggerCapture: (): Promise<AnalysisResult> =>
    ipcRenderer.invoke(IPC.TRIGGER_CAPTURE),

  setFenManual: (fen: string): Promise<AnalysisResult> =>
    ipcRenderer.invoke(IPC.SET_FEN_MANUAL, fen),

  getHint: (fen: string): Promise<HintResult | { error: string }> =>
    ipcRenderer.invoke(IPC.GET_HINT, fen),

  evaluateMove: (
    fen: string,
    moveUci: string,
    moveSan: string,
  ): Promise<MoveEvaluation | { error: string }> =>
    ipcRenderer.invoke(IPC.EVALUATE_MOVE, { fen, moveUci, moveSan }),

  getBotMove: (
    fen: string,
    difficulty: BotDifficulty,
  ): Promise<BotMoveResult | { error: string }> =>
    ipcRenderer.invoke(IPC.GET_BOT_MOVE, { fen, difficulty }),

  analyzePosition: (fen: string): Promise<PositionAnalysis> =>
    ipcRenderer.invoke(IPC.ANALYZE_POSITION, { fen }),

  onAnalysisUpdate: (cb: (result: AnalysisResult) => void): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      result: AnalysisResult,
    ) => cb(result);
    ipcRenderer.on(IPC.ANALYSIS_UPDATE, listener);
    return () => ipcRenderer.removeListener(IPC.ANALYSIS_UPDATE, listener);
  },

  onStatusUpdate: (cb: (update: StatusUpdate) => void): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      update: StatusUpdate,
    ) => cb(update);
    ipcRenderer.on(IPC.STATUS_UPDATE, listener);
    return () => ipcRenderer.removeListener(IPC.STATUS_UPDATE, listener);
  },

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.GET_SETTINGS),

  saveSettings: (settings: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.SAVE_SETTINGS, settings),

  toggleSide: (side: 'w' | 'b'): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.TOGGLE_SIDE, side),

  onSettingsChanged: (cb: (settings: AppSettings) => void): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      settings: AppSettings,
    ) => cb(settings);
    ipcRenderer.on(IPC.SETTINGS_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.SETTINGS_CHANGED, listener);
  },

  // Check whether calibration data exists (used on startup)
  getCalibration: (): Promise<CalibrationData | null> =>
    ipcRenderer.invoke(IPC.GET_CALIBRATION),

  // ── Calibration wizard API ────────────────────────────────────────────────
  calibration: {
    /** Trigger screenshot capture; result pushed via onScreenshot. */
    start: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.CALIBRATION_START),

    /** Confirm the user-drawn board region; result pushed via onInit. */
    confirmRegion: (
      payload: CalibrationConfirmRegionPayload,
    ): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.CALIBRATION_CONFIRM_REGION, payload),

    /** Auto-extract templates from the starting position and persist. */
    save: (isFlipped: boolean): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.CALIBRATION_SAVE, isFlipped),

    /** Discard in-progress calibration without saving. */
    cancel: (): Promise<{ success: boolean }> =>
      ipcRenderer.invoke(IPC.CALIBRATION_CANCEL),

    onScreenshot: (
      cb: (payload: CalibrationScreenshotPayload) => void,
    ): (() => void) => {
      const listener = (
        _e: Electron.IpcRendererEvent,
        p: CalibrationScreenshotPayload,
      ) => cb(p);
      ipcRenderer.on(IPC.CALIBRATION_SCREENSHOT, listener);
      return () =>
        ipcRenderer.removeListener(IPC.CALIBRATION_SCREENSHOT, listener);
    },

    onInit: (cb: (payload: CalibrationInitPayload) => void): (() => void) => {
      const listener = (
        _e: Electron.IpcRendererEvent,
        p: CalibrationInitPayload,
      ) => cb(p);
      ipcRenderer.on(IPC.CALIBRATION_INIT, listener);
      return () => ipcRenderer.removeListener(IPC.CALIBRATION_INIT, listener);
    },

    onComplete: (cb: (data: CalibrationData) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, d: CalibrationData) =>
        cb(d);
      ipcRenderer.on(IPC.CALIBRATION_COMPLETE, listener);
      return () =>
        ipcRenderer.removeListener(IPC.CALIBRATION_COMPLETE, listener);
    },

    onError: (cb: (e: { message: string }) => void): (() => void) => {
      const listener = (
        _e: Electron.IpcRendererEvent,
        err: { message: string },
      ) => cb(err);
      ipcRenderer.on(IPC.CALIBRATION_ERROR, listener);
      return () => ipcRenderer.removeListener(IPC.CALIBRATION_ERROR, listener);
    },
  },
});

// Type declaration for renderer access
declare global {
  interface Window {
    chessHelper: {
      triggerCapture: () => Promise<AnalysisResult>;
      setFenManual: (fen: string) => Promise<AnalysisResult>;
      getHint: (fen: string) => Promise<HintResult | { error: string }>;
      evaluateMove: (
        fen: string,
        moveUci: string,
        moveSan: string,
      ) => Promise<MoveEvaluation | { error: string }>;
      getBotMove: (
        fen: string,
        difficulty: BotDifficulty,
      ) => Promise<BotMoveResult | { error: string }>;
      analyzePosition: (fen: string) => Promise<PositionAnalysis>;
      onAnalysisUpdate: (cb: (result: AnalysisResult) => void) => () => void;
      onStatusUpdate: (cb: (update: StatusUpdate) => void) => () => void;
      getSettings: () => Promise<AppSettings>;
      saveSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
      toggleSide: (side: 'w' | 'b') => Promise<AppSettings>;
      onSettingsChanged: (cb: (settings: AppSettings) => void) => () => void;
      getCalibration: () => Promise<CalibrationData | null>;
      calibration: {
        start: () => Promise<{ success: boolean; error?: string }>;
        confirmRegion: (
          payload: CalibrationConfirmRegionPayload,
        ) => Promise<{ success: boolean; error?: string }>;
        save: (
          isFlipped: boolean,
        ) => Promise<{ success: boolean; error?: string }>;
        cancel: () => Promise<{ success: boolean }>;
        onScreenshot: (
          cb: (payload: CalibrationScreenshotPayload) => void,
        ) => () => void;
        onInit: (cb: (payload: CalibrationInitPayload) => void) => () => void;
        onComplete: (cb: (data: CalibrationData) => void) => () => void;
        onError: (cb: (e: { message: string }) => void) => () => void;
      };
    };
  }
}
