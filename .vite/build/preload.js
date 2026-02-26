"use strict";
const electron = require("electron");
const IPC = {
  SET_FEN_MANUAL: "set-fen-manual",
  GET_HINT: "get-hint",
  EVALUATE_MOVE: "evaluate-move",
  GET_BOT_MOVE: "get-bot-move",
  ANALYZE_POSITION: "analyze-position",
  GET_SETTINGS: "get-settings",
  SAVE_SETTINGS: "save-settings",
  GET_CALIBRATION: "get-calibration",
  // Calibration: Renderer → Main (invoke)
  CALIBRATION_START: "calibration:start",
  CALIBRATION_CONFIRM_REGION: "calibration:confirm-region",
  CALIBRATION_CANCEL: "calibration:cancel",
  CALIBRATION_SAVE: "calibration:save",
  STATUS_UPDATE: "status-update",
  SETTINGS_CHANGED: "settings-changed",
  // Calibration: Main → Renderer (send)
  CALIBRATION_SCREENSHOT: "calibration:screenshot",
  CALIBRATION_INIT: "calibration:init",
  CALIBRATION_COMPLETE: "calibration:complete",
  CALIBRATION_ERROR: "calibration:error"
};
electron.contextBridge.exposeInMainWorld("chessHelper", {
  setFenManual: (fen) => electron.ipcRenderer.invoke(IPC.SET_FEN_MANUAL, fen),
  getHint: (fen) => electron.ipcRenderer.invoke(IPC.GET_HINT, fen),
  evaluateMove: (fen, moveUci, moveSan) => electron.ipcRenderer.invoke(IPC.EVALUATE_MOVE, { fen, moveUci, moveSan }),
  getBotMove: (fen, difficulty) => electron.ipcRenderer.invoke(IPC.GET_BOT_MOVE, { fen, difficulty }),
  analyzePosition: (fen) => electron.ipcRenderer.invoke(IPC.ANALYZE_POSITION, { fen }),
  onStatusUpdate: (cb) => {
    const listener = (_event, update) => cb(update);
    electron.ipcRenderer.on(IPC.STATUS_UPDATE, listener);
    return () => electron.ipcRenderer.removeListener(IPC.STATUS_UPDATE, listener);
  },
  getSettings: () => electron.ipcRenderer.invoke(IPC.GET_SETTINGS),
  saveSettings: (settings) => electron.ipcRenderer.invoke(IPC.SAVE_SETTINGS, settings),
  onSettingsChanged: (cb) => {
    const listener = (_event, settings) => cb(settings);
    electron.ipcRenderer.on(IPC.SETTINGS_CHANGED, listener);
    return () => electron.ipcRenderer.removeListener(IPC.SETTINGS_CHANGED, listener);
  },
  // Check whether calibration data exists (used on startup)
  getCalibration: () => electron.ipcRenderer.invoke(IPC.GET_CALIBRATION),
  // ── Calibration wizard API ────────────────────────────────────────────────
  calibration: {
    /** Trigger screenshot capture; result pushed via onScreenshot. */
    start: () => electron.ipcRenderer.invoke(IPC.CALIBRATION_START),
    /** Confirm the user-drawn board region; result pushed via onInit. */
    confirmRegion: (payload) => electron.ipcRenderer.invoke(IPC.CALIBRATION_CONFIRM_REGION, payload),
    /** Auto-extract templates from the starting position and persist. */
    save: (isFlipped) => electron.ipcRenderer.invoke(IPC.CALIBRATION_SAVE, isFlipped),
    /** Discard in-progress calibration without saving. */
    cancel: () => electron.ipcRenderer.invoke(IPC.CALIBRATION_CANCEL),
    onScreenshot: (cb) => {
      const listener = (_e, p) => cb(p);
      electron.ipcRenderer.on(IPC.CALIBRATION_SCREENSHOT, listener);
      return () => electron.ipcRenderer.removeListener(IPC.CALIBRATION_SCREENSHOT, listener);
    },
    onInit: (cb) => {
      const listener = (_e, p) => cb(p);
      electron.ipcRenderer.on(IPC.CALIBRATION_INIT, listener);
      return () => electron.ipcRenderer.removeListener(IPC.CALIBRATION_INIT, listener);
    },
    onComplete: (cb) => {
      const listener = (_e, d) => cb(d);
      electron.ipcRenderer.on(IPC.CALIBRATION_COMPLETE, listener);
      return () => electron.ipcRenderer.removeListener(IPC.CALIBRATION_COMPLETE, listener);
    },
    onError: (cb) => {
      const listener = (_e, err) => cb(err);
      electron.ipcRenderer.on(IPC.CALIBRATION_ERROR, listener);
      return () => electron.ipcRenderer.removeListener(IPC.CALIBRATION_ERROR, listener);
    }
  }
});
