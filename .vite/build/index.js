"use strict";
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const electron = require("electron");
const path = require("path");
const fs = require("fs");
const chess_js = require("chess.js");
const child_process = require("child_process");
const events = require("events");
const sharp = require("sharp");
const screenshot = require("screenshot-desktop");
const Store = require("electron-store");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path);
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs);
class StockfishProcess extends events.EventEmitter {
  constructor(stockfishPath) {
    super();
    __publicField(this, "proc", null);
    __publicField(this, "ready", false);
    __publicField(this, "buffer", "");
    __publicField(this, "currentResolve", null);
    __publicField(this, "currentReject", null);
    __publicField(this, "multiPVLines", /* @__PURE__ */ new Map());
    __publicField(this, "analyzeTimeout", null);
    this.stockfishPath = stockfishPath;
  }
  async initialize() {
    return new Promise((resolve, reject) => {
      try {
        this.proc = child_process.spawn(this.stockfishPath, [], {
          stdio: ["pipe", "pipe", "pipe"]
        });
        this.proc.stdout.on("data", (data) => {
          this.buffer += data.toString();
          const lines = this.buffer.split("\n");
          this.buffer = lines.pop() ?? "";
          for (const line of lines) {
            this.handleLine(line.trim());
          }
        });
        this.proc.stderr.on("data", (data) => {
          console.error("[Stockfish stderr]", data.toString());
        });
        this.proc.on("error", (err) => {
          console.error("[Stockfish process error]", err);
          this.emit("error", err);
          reject(err);
        });
        this.proc.on("exit", (code) => {
          console.log("[Stockfish] exited with code", code);
          this.ready = false;
          this.emit("exit", code);
        });
        this.once("uciok", () => {
          this.send("isready");
        });
        this.once("readyok", () => {
          this.ready = true;
          resolve();
        });
        const initTimeout = setTimeout(() => {
          reject(new Error("Stockfish initialization timed out"));
        }, 1e4);
        this.once("readyok", () => clearTimeout(initTimeout));
        this.send("uci");
      } catch (err) {
        reject(err);
      }
    });
  }
  handleLine(line) {
    if (!line) return;
    if (line === "uciok") {
      this.emit("uciok");
      return;
    }
    if (line === "readyok") {
      this.emit("readyok");
      return;
    }
    if (line.startsWith("info") && line.includes("multipv")) {
      this.parseInfoLine(line);
      return;
    }
    if (line.startsWith("bestmove")) {
      this.finishAnalysis();
      return;
    }
  }
  parseInfoLine(line) {
    const tokens = line.split(" ");
    let i = 0;
    let depth = 0;
    let multipv = 1;
    let scoreCp = null;
    let mateIn = null;
    const pv = [];
    while (i < tokens.length) {
      const token = tokens[i];
      switch (token) {
        case "depth":
          depth = parseInt(tokens[++i], 10);
          break;
        case "multipv":
          multipv = parseInt(tokens[++i], 10);
          break;
        case "score":
          i++;
          if (tokens[i] === "cp") {
            scoreCp = parseInt(tokens[++i], 10);
            mateIn = null;
          } else if (tokens[i] === "mate") {
            mateIn = parseInt(tokens[++i], 10);
            scoreCp = null;
          }
          break;
        case "pv":
          i++;
          while (i < tokens.length) {
            pv.push(tokens[i++]);
          }
          continue;
      }
      i++;
    }
    if (multipv > 0) {
      this.multiPVLines.set(multipv, { multipv, depth, scoreCp, mateIn, pv });
    }
  }
  finishAnalysis() {
    if (this.analyzeTimeout) {
      clearTimeout(this.analyzeTimeout);
      this.analyzeTimeout = null;
    }
    if (!this.currentResolve) return;
    const moves = Array.from(this.multiPVLines.values()).sort((a, b) => a.multipv - b.multipv).map((line) => ({
      rank: line.multipv,
      uci: line.pv[0] ?? "",
      san: "",
      // will be converted by engine-manager
      scoreCp: line.scoreCp,
      mateIn: line.mateIn,
      depth: line.depth,
      pv: line.pv
    }));
    const resolve = this.currentResolve;
    this.currentResolve = null;
    this.currentReject = null;
    resolve(moves);
  }
  analyze(fen, depth, multiPV) {
    return new Promise((resolve, reject) => {
      if (!this.ready || !this.proc) {
        reject(new Error("Stockfish is not ready"));
        return;
      }
      this.multiPVLines = /* @__PURE__ */ new Map();
      this.currentResolve = resolve;
      this.currentReject = reject;
      this.send("ucinewgame");
      this.send(`setoption name MultiPV value ${multiPV}`);
      this.send(`position fen ${fen}`);
      this.send(`go depth ${depth}`);
      this.analyzeTimeout = setTimeout(() => {
        this.send("stop");
      }, 3e4);
    });
  }
  stopAnalysis() {
    if (this.proc && this.ready) {
      this.send("stop");
    }
  }
  send(cmd) {
    var _a, _b;
    if ((_b = (_a = this.proc) == null ? void 0 : _a.stdin) == null ? void 0 : _b.writable) {
      this.proc.stdin.write(cmd + "\n");
    }
  }
  isReady() {
    return this.ready;
  }
  shutdown() {
    if (this.proc) {
      this.send("quit");
      setTimeout(() => {
        if (this.proc) {
          this.proc.kill();
          this.proc = null;
        }
      }, 1e3);
      this.ready = false;
    }
  }
}
class EngineManager {
  constructor() {
    __publicField(this, "engine", null);
    __publicField(this, "analyzing", false);
    __publicField(this, "queue", []);
  }
  /**
   * Find the Stockfish binary in common locations.
   */
  static findStockfishPath(overridePath) {
    if (overridePath && fs__namespace.existsSync(overridePath)) {
      return overridePath;
    }
    const platform = process.platform;
    const binaryName = platform === "win32" ? "stockfish-win.exe" : platform === "darwin" ? "stockfish-mac" : "stockfish-linux";
    const resourcesPath = process.resourcesPath ?? "";
    const extraResourcePath = path__namespace.join(resourcesPath, "stockfish", binaryName);
    if (fs__namespace.existsSync(extraResourcePath)) {
      return extraResourcePath;
    }
    const devPath = path__namespace.join(electron.app.getAppPath(), "assets", "stockfish", binaryName);
    if (fs__namespace.existsSync(devPath)) {
      return devPath;
    }
    const fromDirname = path__namespace.join(__dirname, "..", "..", "assets", "stockfish", binaryName);
    if (fs__namespace.existsSync(fromDirname)) {
      return fromDirname;
    }
    const fromDirname2 = path__namespace.join(__dirname, "..", "..", "..", "assets", "stockfish", binaryName);
    if (fs__namespace.existsSync(fromDirname2)) {
      return fromDirname2;
    }
    const systemName = platform === "win32" ? "stockfish.exe" : "stockfish";
    return systemName;
  }
  async initialize(stockfishPath) {
    const sfPath = EngineManager.findStockfishPath(stockfishPath);
    console.log("[EngineManager] Using Stockfish at:", sfPath);
    this.engine = new StockfishProcess(sfPath);
    try {
      await this.engine.initialize();
      console.log("[EngineManager] Stockfish ready");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to start Stockfish: ${msg}

Please download Stockfish from https://stockfishchess.org/download/ and place the binary at: assets/stockfish/${path__namespace.basename(sfPath)}`
      );
    }
  }
  /**
   * Analyze a FEN position and return top N moves.
   * Queues requests so only one analysis runs at a time.
   */
  analyze(fen, depth = 18, multiPV = 5) {
    return new Promise((resolve, reject) => {
      const run = async () => {
        if (!this.engine || !this.engine.isReady()) {
          reject(new Error("Engine not initialized"));
          this.runNext();
          return;
        }
        this.analyzing = true;
        try {
          const rawMoves = await this.engine.analyze(fen, depth, multiPV);
          const moves = this.convertToSAN(fen, rawMoves);
          resolve(moves);
        } catch (err) {
          reject(err);
        } finally {
          this.analyzing = false;
          this.runNext();
        }
      };
      if (this.analyzing) {
        this.queue.push(run);
      } else {
        run();
      }
    });
  }
  runNext() {
    const next = this.queue.shift();
    if (next) next();
  }
  /**
   * Convert UCI move notation to SAN using chess.js.
   */
  convertToSAN(fen, moves) {
    return moves.map((move) => {
      if (!move.uci || move.uci.length < 4) return move;
      try {
        const chess = new chess_js.Chess(fen);
        const from = move.uci.slice(0, 2);
        const to = move.uci.slice(2, 4);
        const promotion = move.uci.length === 5 ? move.uci[4] : void 0;
        const result = chess.move({
          from,
          to,
          promotion
        });
        return { ...move, san: (result == null ? void 0 : result.san) ?? move.uci };
      } catch {
        return { ...move, san: move.uci };
      }
    });
  }
  isReady() {
    var _a;
    return ((_a = this.engine) == null ? void 0 : _a.isReady()) ?? false;
  }
  shutdown() {
    var _a;
    (_a = this.engine) == null ? void 0 : _a.shutdown();
    this.engine = null;
  }
}
const IPC = {
  // Renderer → Main (invoke)
  TRIGGER_CAPTURE: "trigger-capture",
  SET_FEN_MANUAL: "set-fen-manual",
  GET_HINT: "get-hint",
  EVALUATE_MOVE: "evaluate-move",
  GET_BOT_MOVE: "get-bot-move",
  ANALYZE_POSITION: "analyze-position",
  GET_SETTINGS: "get-settings",
  SAVE_SETTINGS: "save-settings",
  TOGGLE_SIDE: "toggle-side",
  GET_STATUS: "get-status",
  GET_CALIBRATION: "get-calibration",
  // Calibration: Renderer → Main (invoke)
  CALIBRATION_START: "calibration:start",
  CALIBRATION_CONFIRM_REGION: "calibration:confirm-region",
  CALIBRATION_CANCEL: "calibration:cancel",
  CALIBRATION_SAVE: "calibration:save",
  // Main → Renderer (send)
  ANALYSIS_UPDATE: "analysis-update",
  STATUS_UPDATE: "status-update",
  SETTINGS_CHANGED: "settings-changed",
  // Calibration: Main → Renderer (send)
  CALIBRATION_SCREENSHOT: "calibration:screenshot",
  CALIBRATION_INIT: "calibration:init",
  CALIBRATION_COMPLETE: "calibration:complete",
  CALIBRATION_ERROR: "calibration:error"
};
const TEMPLATE_SIZE = 48;
const WHITE_BACK = ["R", "N", "B", "Q", "K", "B", "N", "R"];
const BLACK_BACK = ["r", "n", "b", "q", "k", "b", "n", "r"];
function startingPieceAt(imgRow, imgCol, isFlipped) {
  let file, rank;
  if (!isFlipped) {
    file = imgCol;
    rank = 8 - imgRow;
  } else {
    file = 7 - imgCol;
    rank = imgRow + 1;
  }
  switch (rank) {
    case 1:
      return WHITE_BACK[file];
    case 2:
      return "P";
    case 7:
      return "p";
    case 8:
      return BLACK_BACK[file];
    default:
      return null;
  }
}
function isLightSquare(imgRow, imgCol) {
  return (imgRow + imgCol) % 2 === 0;
}
function validateFEN(fen) {
  try {
    new chess_js.Chess(fen);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) };
  }
}
async function captureScreen() {
  try {
    const imgBuffer = await screenshot({ format: "png" });
    const { width, height } = parsePngDimensions(imgBuffer);
    return { buffer: imgBuffer, width, height };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("permission") || msg.toLowerCase().includes("screen recording") || msg.toLowerCase().includes("screencapture")) {
      throw new Error(
        "Screen Recording permission required.\n\nPlease go to System Settings → Privacy & Security → Screen Recording\nand enable access for Chess Helper Overlay.\n\nThen restart the application."
      );
    }
    throw new Error(`Screenshot capture failed: ${msg}`);
  }
}
function parsePngDimensions(buffer) {
  if (buffer.length < 24) {
    throw new Error("Invalid PNG buffer: too short");
  }
  const sig = buffer.slice(0, 8);
  const expectedSig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!sig.equals(expectedSig)) {
    throw new Error("Not a valid PNG buffer");
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}
const PREVIEW_SIZE = 560;
let screenshotBuffer = null;
let screenshotWidth = 0;
let screenshotHeight = 0;
let screenshotPreviewW = 0;
let screenshotPreviewH = 0;
let boardImageBuffer = null;
let boardWidthPx = 0;
let boardHeightPx = 0;
let previewWidthPx = 0;
let previewHeightPx = 0;
let boardRect = null;
async function captureScreenForCalibration() {
  boardImageBuffer = null;
  boardRect = null;
  const sc = await captureScreen();
  screenshotBuffer = sc.buffer;
  screenshotWidth = sc.width;
  screenshotHeight = sc.height;
  console.log(
    `[Calibration] Screenshot buffer size: ${screenshotWidth}×${screenshotHeight}`
  );
  const longestEdge = Math.max(screenshotWidth, screenshotHeight);
  const scale = longestEdge > PREVIEW_SIZE ? PREVIEW_SIZE / longestEdge : 1;
  screenshotPreviewW = Math.round(screenshotWidth * scale);
  screenshotPreviewH = Math.round(screenshotHeight * scale);
  const previewBuffer = await sharp(screenshotBuffer).resize(screenshotPreviewW, screenshotPreviewH, { kernel: "lanczos3" }).png().toBuffer();
  console.log(
    `[Calibration] Screenshot preview: ${screenshotPreviewW}×${screenshotPreviewH}`
  );
  return {
    screenshotDataUrl: `data:image/png;base64,${previewBuffer.toString("base64")}`,
    screenshotWidthPx: screenshotPreviewW,
    screenshotHeightPx: screenshotPreviewH
  };
}
async function confirmBoardRegion(payload) {
  if (!screenshotBuffer) {
    throw new Error(
      "No screenshot available — call captureScreenForCalibration() first."
    );
  }
  const scaleX = screenshotWidth / payload.displayWidth;
  const scaleY = screenshotHeight / payload.displayHeight;
  const nativeX = Math.round(payload.x * scaleX);
  const nativeY = Math.round(payload.y * scaleY);
  const nativeW = Math.round(payload.width * scaleX);
  const nativeH = Math.round(payload.height * scaleY);
  const left = Math.max(0, Math.min(nativeX, screenshotWidth - 1));
  const top = Math.max(0, Math.min(nativeY, screenshotHeight - 1));
  const right = Math.min(screenshotWidth, nativeX + nativeW);
  const bottom = Math.min(screenshotHeight, nativeY + nativeH);
  const cropW = right - left;
  const cropH = bottom - top;
  if (cropW < 40 || cropH < 40) {
    throw new Error(
      "Selected region is too small. Please draw a larger rectangle around the board."
    );
  }
  console.log(
    `[Calibration] User region: preview=(${payload.x},${payload.y} ${payload.width}×${payload.height}) → native=(${left},${top} ${cropW}×${cropH})`
  );
  boardRect = { x: left, y: top, width: cropW, height: cropH };
  boardImageBuffer = await sharp(screenshotBuffer).extract({ left, top, width: cropW, height: cropH }).png().toBuffer();
  const meta = await sharp(boardImageBuffer).metadata();
  boardWidthPx = meta.width ?? cropW;
  boardHeightPx = meta.height ?? cropH;
  console.log(
    `[Calibration] Native board buffer: ${boardWidthPx}×${boardHeightPx}`
  );
  const longestEdge = Math.max(boardWidthPx, boardHeightPx);
  const previewScale = longestEdge > PREVIEW_SIZE ? PREVIEW_SIZE / longestEdge : 1;
  previewWidthPx = Math.round(boardWidthPx * previewScale);
  previewHeightPx = Math.round(boardHeightPx * previewScale);
  const previewBuffer = await sharp(boardImageBuffer).resize(previewWidthPx, previewHeightPx, { kernel: "lanczos3" }).png().toBuffer();
  console.log(
    `[Calibration] Board preview: ${previewWidthPx}×${previewHeightPx} (scale=${previewScale.toFixed(3)})`
  );
  screenshotBuffer = null;
  return {
    boardImageDataUrl: `data:image/png;base64,${previewBuffer.toString("base64")}`,
    boardWidthPx: previewWidthPx,
    boardHeightPx: previewHeightPx
  };
}
async function buildCalibrationData(isFlipped) {
  if (!boardImageBuffer || !boardRect) {
    throw new Error(
      "Board region not set — complete the board selection step first."
    );
  }
  console.log(
    `[Calibration] Extracting 64 templates (isFlipped=${isFlipped})…`
  );
  const sqW = boardWidthPx / 8;
  const sqH = boardHeightPx / 8;
  const templates = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = startingPieceAt(row, col, isFlipped);
      const light = isLightSquare(row, col);
      const marginX = sqW * 0.15;
      const marginY = sqH * 0.15;
      const cropLeft = Math.max(0, Math.round(col * sqW + marginX));
      const cropTop = Math.max(0, Math.round(row * sqH + marginY));
      const cropW2 = Math.min(
        boardWidthPx - cropLeft,
        Math.round(sqW - 2 * marginX)
      );
      const cropH2 = Math.min(
        boardHeightPx - cropTop,
        Math.round(sqH - 2 * marginY)
      );
      const raw = await sharp(boardImageBuffer).extract({
        left: cropLeft,
        top: cropTop,
        width: cropW2,
        height: cropH2
      }).resize(TEMPLATE_SIZE, TEMPLATE_SIZE, { kernel: "lanczos3" }).blur(1).removeAlpha().raw().toBuffer();
      templates.push({
        piece,
        isLightSquare: light,
        imageBase64: raw.toString("base64")
      });
      const label = piece ?? ".";
      const bg = light ? "L" : "D";
      if (row === 0 || row === 1 || row === 6 || row === 7) {
        console.log(
          `  [${row},${col}] ${label} on ${bg} → ${raw.length} bytes`
        );
      }
    }
  }
  console.log(`[Calibration] Extracted ${templates.length} templates`);
  return {
    templates,
    boardRect,
    isFlipped,
    capturedAt: Date.now()
  };
}
function cancelCalibration() {
  screenshotBuffer = null;
  boardImageBuffer = null;
  boardRect = null;
}
function getBoardDimensions() {
  return { width: previewWidthPx, height: previewHeightPx };
}
const DEFAULT_SETTINGS = {
  captureHotkey: "CommandOrControl+Shift+C",
  sideToMove: "w",
  analysisDepth: 18,
  multiPV: 5,
  stockfishPath: "",
  windowOpacity: 0.92,
  windowX: null,
  windowY: null,
  castlingRights: "KQkq"
};
let store = null;
function initStore() {
  if (!store) {
    store = new Store({
      defaults: {
        ...DEFAULT_SETTINGS,
        calibration: null
      },
      name: "chess-helper-settings"
    });
  }
  return store;
}
function getSettings() {
  const s = initStore();
  return {
    captureHotkey: s.get("captureHotkey", DEFAULT_SETTINGS.captureHotkey),
    sideToMove: s.get("sideToMove", DEFAULT_SETTINGS.sideToMove),
    analysisDepth: s.get("analysisDepth", DEFAULT_SETTINGS.analysisDepth),
    multiPV: s.get("multiPV", DEFAULT_SETTINGS.multiPV),
    stockfishPath: s.get("stockfishPath", DEFAULT_SETTINGS.stockfishPath),
    windowOpacity: s.get("windowOpacity", DEFAULT_SETTINGS.windowOpacity),
    windowX: s.get("windowX", DEFAULT_SETTINGS.windowX),
    windowY: s.get("windowY", DEFAULT_SETTINGS.windowY),
    castlingRights: s.get("castlingRights", DEFAULT_SETTINGS.castlingRights)
  };
}
function saveSettings(partial) {
  const s = initStore();
  const current = getSettings();
  const updated = { ...current, ...partial };
  Object.keys(updated).forEach((key) => {
    s.set(key, updated[key]);
  });
  return updated;
}
function getCalibration() {
  const raw = initStore().get("calibration", null) ?? null;
  if (raw && !Array.isArray(raw.templates)) {
    console.warn("[Store] Discarding incompatible legacy calibration data");
    initStore().set("calibration", null);
    return null;
  }
  return raw;
}
function saveCalibration(data) {
  initStore().set("calibration", data);
}
let tracker = null;
function resetGameTracker() {
  if (tracker) {
    tracker.reset();
  }
  tracker = null;
}
function sendStatus(win, status, message) {
  win.webContents.send(IPC.STATUS_UPDATE, { status, message });
}
function registerIpcHandlers(win, engine) {
  electron.ipcMain.handle(IPC.SET_FEN_MANUAL, async (_event, fen) => {
    return runAnalysis(win, engine, fen, null, 1);
  });
  electron.ipcMain.handle(IPC.GET_HINT, async (_event, fen) => {
    return getHint(win, engine, fen);
  });
  electron.ipcMain.handle(
    IPC.EVALUATE_MOVE,
    async (_event, payload) => {
      return evaluateMove(
        win,
        engine,
        payload.fen,
        payload.moveUci,
        payload.moveSan
      );
    }
  );
  electron.ipcMain.handle(
    IPC.GET_BOT_MOVE,
    async (_event, payload) => {
      return getBotMove(win, engine, payload.fen, payload.difficulty);
    }
  );
  electron.ipcMain.handle(
    IPC.ANALYZE_POSITION,
    async (_event, payload) => {
      return analyzePosition(win, engine, payload.fen);
    }
  );
  electron.ipcMain.handle(IPC.GET_SETTINGS, () => {
    return getSettings();
  });
  electron.ipcMain.handle(IPC.SAVE_SETTINGS, (_event, partial) => {
    const updated = saveSettings(partial);
    win.webContents.send(IPC.SETTINGS_CHANGED, updated);
    return updated;
  });
  electron.ipcMain.handle(IPC.GET_CALIBRATION, () => {
    return getCalibration();
  });
  registerCalibrationHandlers(win);
}
const NORMAL_WIDTH = 320;
const NORMAL_HEIGHT = 700;
const WIZARD_CHROME_HEIGHT = 180;
const WIZARD_SELECT_CHROME_HEIGHT = 100;
function resizeForScreenshot(win, screenshotW, screenshotH) {
  const winW = screenshotW;
  const winH = screenshotH + WIZARD_SELECT_CHROME_HEIGHT;
  console.log(
    `[Calibration] Resize for selection → screenshot: ${screenshotW}×${screenshotH}, window: ${winW}×${winH}`
  );
  win.setResizable(true);
  win.setMinimumSize(1, 1);
  win.setMaximumSize(9999, 9999);
  win.setContentSize(winW, winH, true);
  win.setMinimumSize(winW, winH);
  win.setMaximumSize(winW, winH);
  win.setResizable(false);
}
function resizeForCalibration(win) {
  const { width, height } = getBoardDimensions();
  const winW = width;
  const winH = height + WIZARD_CHROME_HEIGHT;
  console.log(
    `[Calibration] Resize → preview: ${width}×${height}, window: ${winW}×${winH}`
  );
  win.setResizable(true);
  win.setMinimumSize(1, 1);
  win.setMaximumSize(9999, 9999);
  win.setContentSize(
    winW,
    winH,
    true
    /* animate */
  );
  win.setMinimumSize(winW, winH);
  win.setMaximumSize(winW, winH);
  win.setResizable(false);
}
function restoreNormalSize(win) {
  win.setResizable(true);
  win.setMinimumSize(1, 1);
  win.setMaximumSize(9999, 9999);
  win.setContentSize(NORMAL_WIDTH, NORMAL_HEIGHT, true);
  win.setMinimumSize(NORMAL_WIDTH, 500);
  win.setMaximumSize(NORMAL_WIDTH, 1200);
  win.setResizable(true);
}
function registerCalibrationHandlers(win) {
  electron.ipcMain.handle(IPC.CALIBRATION_START, async () => {
    try {
      const payload = await captureScreenForCalibration();
      resizeForScreenshot(
        win,
        payload.screenshotWidthPx,
        payload.screenshotHeightPx
      );
      win.webContents.send(IPC.CALIBRATION_SCREENSHOT, payload);
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      win.webContents.send(IPC.CALIBRATION_ERROR, { message });
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle(
    IPC.CALIBRATION_CONFIRM_REGION,
    async (_event, payload) => {
      try {
        const initPayload = await confirmBoardRegion(payload);
        resizeForCalibration(win);
        win.webContents.send(IPC.CALIBRATION_INIT, initPayload);
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        win.webContents.send(IPC.CALIBRATION_ERROR, { message });
        return { success: false, error: message };
      }
    }
  );
  electron.ipcMain.handle(IPC.CALIBRATION_SAVE, async (_event, isFlipped) => {
    try {
      const data = await buildCalibrationData(isFlipped);
      saveCalibration(data);
      resetGameTracker();
      restoreNormalSize(win);
      win.webContents.send(IPC.CALIBRATION_COMPLETE, data);
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      win.webContents.send(IPC.CALIBRATION_ERROR, { message });
      return { success: false, error: message };
    }
  });
  electron.ipcMain.handle(IPC.CALIBRATION_CANCEL, () => {
    cancelCalibration();
    restoreNormalSize(win);
    return { success: true };
  });
}
async function runAnalysis(win, engine, fen, board, gridConfidence) {
  const settings = getSettings();
  const fenValidation = validateFEN(fen);
  if (!fenValidation.valid) {
    const result = {
      fen,
      moves: [],
      detectedBoard: null,
      boardGridConfidence: gridConfidence,
      timestamp: Date.now(),
      error: `Invalid FEN: ${fenValidation.error}`
    };
    win.webContents.send(IPC.ANALYSIS_UPDATE, result);
    sendStatus(win, "error", "Invalid FEN");
    return result;
  }
  if (!engine.isReady()) {
    const result = {
      fen,
      moves: [],
      detectedBoard: null,
      boardGridConfidence: gridConfidence,
      timestamp: Date.now(),
      error: "Chess engine not ready. Please ensure Stockfish is installed."
    };
    win.webContents.send(IPC.ANALYSIS_UPDATE, result);
    sendStatus(win, "error", "Engine not ready");
    return result;
  }
  sendStatus(
    win,
    "analyzing",
    `Analyzing position (depth ${settings.analysisDepth})…`
  );
  try {
    const moves = await engine.analyze(
      fen,
      settings.analysisDepth,
      settings.multiPV
    );
    const result = {
      fen,
      moves,
      detectedBoard: board,
      boardGridConfidence: gridConfidence,
      timestamp: Date.now()
    };
    win.webContents.send(IPC.ANALYSIS_UPDATE, result);
    sendStatus(win, "done", `Found ${moves.length} moves`);
    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const result = {
      fen,
      moves: [],
      detectedBoard: board,
      boardGridConfidence: gridConfidence,
      timestamp: Date.now(),
      error: `Analysis failed: ${errorMsg}`
    };
    win.webContents.send(IPC.ANALYSIS_UPDATE, result);
    sendStatus(win, "error", "Analysis failed");
    return result;
  }
}
function detectThemes(fen, move) {
  const themes = [];
  const san = move.san || "";
  const uci = move.uci || "";
  const pv = move.pv || [];
  try {
    const game = new chess_js.Chess(fen);
    const sideToMove = game.turn();
    const opponentColor = sideToMove === "w" ? "b" : "w";
    if (game.isCheck()) {
      themes.push("You need to get out of check first");
    }
    const isCapture = san.includes("x");
    const isCheck = san.includes("+");
    const isMate = san.includes("#");
    const isCastle = san === "O-O" || san === "O-O-O";
    const moveResult = game.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4] || void 0
    });
    if (!moveResult) return themes;
    if (isCapture) {
      const capturedPiece = moveResult.captured;
      const pieceValues = {
        p: 1,
        n: 3,
        b: 3,
        r: 5,
        q: 9
      };
      const movingPieceValue = pieceValues[moveResult.piece] ?? 0;
      const capturedValue = capturedPiece ? pieceValues[capturedPiece] ?? 0 : 0;
      if (capturedValue > movingPieceValue) {
        themes.push(`This wins material — you capture a more valuable piece`);
      } else if (capturedValue === movingPieceValue) {
        themes.push(`This is an even trade`);
      }
    }
    if (!isCastle) {
      const targetSquare = uci.slice(2, 4);
      const attacks = game.moves({ verbose: true }).filter((m) => m.from === targetSquare && m.captured);
      if (pv.length >= 2) {
        const nextMoveStr = pv[1];
        if (nextMoveStr && nextMoveStr.length >= 4) {
        }
      }
    }
    if (isCastle) {
      themes.push("Castling improves king safety and connects your rooks");
    }
    if (isCheck) {
      themes.push("This gives check, forcing your opponent to respond");
    }
    if (isMate) {
      themes.push("This is checkmate!");
    }
    if (moveResult.piece === "p") {
      const targetFile = uci[2];
      const targetRank = parseInt(uci[3]);
      if ((targetRank === 4 || targetRank === 5) && "cdef".includes(targetFile)) {
        themes.push("This fights for central control with a pawn");
      }
      if (sideToMove === "w" && targetRank >= 6 || sideToMove === "b" && targetRank <= 3) {
        themes.push(
          "This is a dangerous passed pawn advancing toward promotion"
        );
      }
    }
    const moveNumber = parseInt(fen.split(" ")[5] || "1");
    if (moveNumber <= 10) {
      if (moveResult.piece === "n" || moveResult.piece === "b") {
        themes.push(
          "Developing a minor piece toward the center is good opening play"
        );
      }
    }
    if (moveResult.piece === "r") {
      const targetFile = uci[2];
      themes.push("Rooks are strongest on open files and the 7th rank");
    }
    if (moveResult.piece === "n") {
      const targetFile = uci[2];
      const targetRank = parseInt(uci[3]);
      if ("cdef".includes(targetFile) && targetRank >= 3 && targetRank <= 6) {
        themes.push(
          "Knights are powerful in the center where they control many squares"
        );
      }
      if (targetFile === "a" || targetFile === "h") {
        themes.push(
          "A knight on the rim is dim — it controls fewer squares on the edge"
        );
      }
    }
    if (pv.length >= 3) {
      themes.push(`The engine sees a plan extending ${pv.length} moves deep`);
    }
    game.undo();
  } catch {
  }
  return themes;
}
function generateCoachingHint(move, fen, allMoves) {
  const san = move.san || "";
  const uci = move.uci || "";
  const scoreCp = move.scoreCp ?? 0;
  fen.split(" ")[1] === "w" ? "White" : "Black";
  const isCapture = san.includes("x");
  const isCheck = san.includes("+");
  const isMate = san.includes("#") || move.mateIn !== null && move.mateIn > 0 && move.mateIn <= 5;
  const isCastle = san === "O-O" || san === "O-O-O";
  const isPromotion = san.includes("=");
  const pieceChar = san[0];
  const pieceNames = {
    K: "king",
    Q: "queen",
    R: "rook",
    B: "bishop",
    N: "knight"
  };
  const isPawnMove = pieceChar === pieceChar.toLowerCase() && !isCastle;
  const pieceName = isPawnMove ? "pawn" : pieceNames[pieceChar] || "piece";
  const targetSquare = uci.slice(2, 4);
  const targetFile = targetSquare[0];
  const fileZone = "abc".includes(targetFile) ? "queenside" : "fgh".includes(targetFile) ? "kingside" : "center";
  const themes = detectThemes(fen, move);
  const secondBestCp = allMoves.length > 1 ? allMoves[1].scoreCp ?? 0 : scoreCp;
  const evalGap = scoreCp - secondBestCp;
  const isOnly = evalGap > 150;
  const moveNumber = parseInt(fen.split(" ")[5] || "1");
  const phase = moveNumber <= 10 ? "opening" : moveNumber <= 25 ? "middlegame" : "endgame";
  const parts = [];
  if (isMate) {
    parts.push(
      "There's a forced checkmate! Carefully examine all checks and look at how your opponent's king is trapped."
    );
    if (move.mateIn !== null && move.mateIn > 1) {
      parts.push(
        `It's a mate in ${move.mateIn} — follow the sequence of forcing moves.`
      );
    }
    return parts.join(" ");
  }
  if (isOnly) {
    parts.push(
      "There's really only one good move here — the alternatives are significantly worse."
    );
  }
  if (phase === "opening") {
    if (isCastle) {
      parts.push(
        "In the opening, king safety is paramount. Think about castling to protect your king and activate your rook."
      );
    } else if (isPawnMove) {
      parts.push(
        "Opening principle: control the center with pawns, then develop your pieces. Which pawn advances help you claim central space?"
      );
    } else if (pieceName === "knight" || pieceName === "bishop") {
      parts.push(
        "Opening principle: develop your minor pieces toward active squares that influence the center. Which piece hasn't moved yet?"
      );
    } else {
      parts.push(
        "Think about opening principles: center control, piece development, and king safety."
      );
    }
  } else if (phase === "middlegame") {
    if (isCapture && isCheck) {
      parts.push(
        "Look for a tactical combination — can you win material while also giving check? That's a powerful combination because your opponent is forced to deal with the check first."
      );
    } else if (isCapture) {
      parts.push(
        `There's a tactical opportunity. Look at the ${fileZone} and consider: are any of your opponent's pieces undefended or overloaded?`
      );
    } else if (isCheck) {
      parts.push(
        "Look for a forcing check. Checks are powerful because they limit your opponent's options. Think about which piece can deliver check and what that achieves."
      );
    } else if (scoreCp > 200) {
      parts.push(
        `You have a strong advantage. Look for ways to increase pressure. Think about: which of your pieces isn't doing enough work on the ${fileZone}?`
      );
    } else if (scoreCp < -100) {
      parts.push(
        "You're under pressure. Look for defensive resources — can you create counterplay or simplify the position?"
      );
    } else {
      parts.push(
        `Think about piece activity — your ${pieceName} could be more effective. Where can it exert maximum influence on the ${fileZone}?`
      );
    }
  } else {
    if (isPawnMove) {
      parts.push(
        "In the endgame, passed pawns are extremely powerful. Think about advancing your pawns toward promotion — every tempo matters."
      );
    } else if (pieceName === "king") {
      parts.push(
        "In the endgame, the king becomes a fighting piece. Centralize your king and use it actively."
      );
    } else {
      parts.push(
        "Endgame principle: activate your pieces, advance passed pawns, and keep your king centralized. Think about the pawn structure."
      );
    }
  }
  const relevantThemes = themes.filter(
    (t) => !t.includes("checkmate") || !isMate
    // avoid redundancy
  ).slice(0, 2);
  if (relevantThemes.length > 0) {
    parts.push(relevantThemes.join(". ") + ".");
  }
  if (isPromotion) {
    parts.push(
      "One of your pawns can promote! Can you safely push it to the back rank?"
    );
  }
  if (move.pv && move.pv.length >= 4 && !isMate) {
    parts.push(
      "Try to think a few moves ahead — if you play the best move, how will your opponent respond, and what's your follow-up?"
    );
  }
  return parts.join(" ");
}
async function getHint(win, engine, fen) {
  const settings = getSettings();
  if (!engine.isReady()) {
    return { error: "Engine not ready" };
  }
  sendStatus(win, "analyzing", "Thinking about a hint…");
  try {
    const moves = await engine.analyze(
      fen,
      settings.analysisDepth,
      Math.max(settings.multiPV, 3)
    );
    if (moves.length === 0) {
      sendStatus(win, "done", "No moves available");
      return { error: "No legal moves in this position" };
    }
    const coachingHint = generateCoachingHint(moves[0], fen, moves);
    sendStatus(win, "done", "Hint ready");
    return { bestMove: moves[0], fen, coachingHint };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendStatus(win, "error", "Hint failed");
    return { error: msg };
  }
}
function describeMoveForModeler(move, fen) {
  var _a;
  const san = move.san || "";
  const uci = move.uci || "";
  const scoreCp = move.scoreCp ?? 0;
  const isCapture = san.includes("x");
  const isCheck = san.includes("+");
  const isMate = san.includes("#");
  const isCastle = san === "O-O" || san === "O-O-O";
  const isPromotion = san.includes("=");
  const pieceChar = san[0];
  const pieceNames = {
    K: "king",
    Q: "queen",
    R: "rook",
    B: "bishop",
    N: "knight"
  };
  const isPawnMove = pieceChar === pieceChar.toLowerCase() && !isCastle;
  const pieceName = isPawnMove ? "Pawn" : pieceNames[pieceChar] || "Piece";
  const targetSquare = uci.slice(2, 4);
  const themes = detectThemes(fen, move);
  const parts = [];
  if (isMate) {
    if (move.mateIn !== null) {
      parts.push(`Checkmate in ${Math.abs(move.mateIn)}.`);
    } else {
      parts.push("Delivers checkmate.");
    }
  } else if (move.mateIn !== null && move.mateIn > 0) {
    parts.push(`Forced mate in ${move.mateIn}.`);
  } else if (isCastle) {
    parts.push(san === "O-O" ? "Castles kingside." : "Castles queenside.");
    parts.push("Improves king safety and activates the rook.");
  } else if (isCapture && isCheck) {
    parts.push(`${pieceName} captures on ${targetSquare} with check.`);
  } else if (isCapture) {
    parts.push(`${pieceName} captures on ${targetSquare}.`);
  } else if (isCheck) {
    parts.push(`${pieceName} to ${targetSquare} with check.`);
  } else if (isPromotion) {
    const promoteTo = ((_a = san.split("=")[1]) == null ? void 0 : _a[0]) || "Q";
    const promoName = pieceNames[promoteTo] || "queen";
    parts.push(`Pawn promotes to ${promoName} on ${targetSquare}.`);
  } else {
    parts.push(`${pieceName} to ${targetSquare}.`);
  }
  const relevantThemes = themes.filter(
    (t) => !t.includes("checkmate") && !t.includes("check") && !t.includes("Castling")
  );
  if (relevantThemes.length > 0) {
    parts.push(relevantThemes[0]);
  }
  if (move.mateIn === null) {
    const evalPawns = scoreCp / 100;
    if (evalPawns > 3) {
      parts.push("Winning position.");
    } else if (evalPawns > 1) {
      parts.push("Clear advantage.");
    } else if (evalPawns > 0.3) {
      parts.push("Slight edge.");
    } else if (evalPawns > -0.3) {
      parts.push("Equal position.");
    } else if (evalPawns > -1) {
      parts.push("Slightly worse.");
    } else if (evalPawns > -3) {
      parts.push("Disadvantage.");
    } else {
      parts.push("Losing position.");
    }
  }
  return parts.join(" ");
}
async function analyzePosition(win, engine, fen) {
  const settings = getSettings();
  if (!engine.isReady()) {
    return { fen, moves: [], error: "Engine not ready" };
  }
  sendStatus(win, "analyzing", "Analyzing position…");
  try {
    const multiPV = Math.max(settings.multiPV, 5);
    const moves = await engine.analyze(fen, settings.analysisDepth, multiPV);
    if (moves.length === 0) {
      sendStatus(win, "done", "No legal moves");
      return { fen, moves: [], error: "No legal moves in this position" };
    }
    const analyzedMoves = moves.map((m) => ({
      ...m,
      description: describeMoveForModeler(m, fen)
    }));
    sendStatus(win, "done", `Found ${analyzedMoves.length} moves`);
    return { fen, moves: analyzedMoves };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendStatus(win, "error", "Analysis failed");
    return { fen, moves: [], error: msg };
  }
}
const BOT_DIFFICULTY_CONFIG = {
  1: { depth: 4, multiPV: 8, pickFromTopN: 8, blunderChance: 0.3 },
  // Beginner: shallow, often picks bad moves
  2: { depth: 6, multiPV: 6, pickFromTopN: 5, blunderChance: 0.15 },
  // Casual: some mistakes
  3: { depth: 10, multiPV: 4, pickFromTopN: 3, blunderChance: 0.05 },
  // Intermediate: mostly good moves
  4: { depth: 14, multiPV: 3, pickFromTopN: 2, blunderChance: 0.02 },
  // Advanced: strong play
  5: { depth: 18, multiPV: 1, pickFromTopN: 1, blunderChance: 0 }
  // Master: best move always
};
async function getBotMove(win, engine, fen, difficulty) {
  if (!engine.isReady()) {
    return { error: "Engine not ready" };
  }
  const config = BOT_DIFFICULTY_CONFIG[difficulty] || BOT_DIFFICULTY_CONFIG[3];
  sendStatus(win, "analyzing", "Opponent is thinking…");
  try {
    const moves = await engine.analyze(fen, config.depth, config.multiPV);
    if (moves.length === 0) {
      sendStatus(win, "done", "No legal moves");
      return { error: "No legal moves for the bot" };
    }
    let chosenMove;
    if (Math.random() < config.blunderChance && moves.length > 2) {
      const worstHalf = moves.slice(Math.floor(moves.length / 2));
      chosenMove = worstHalf[Math.floor(Math.random() * worstHalf.length)];
    } else {
      const topN = moves.slice(0, Math.min(config.pickFromTopN, moves.length));
      const weights = topN.map((_, i) => Math.pow(0.5, i));
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      let rand = Math.random() * totalWeight;
      let idx = 0;
      for (let i = 0; i < weights.length; i++) {
        rand -= weights[i];
        if (rand <= 0) {
          idx = i;
          break;
        }
      }
      chosenMove = topN[idx];
    }
    const game = new chess_js.Chess(fen);
    const result = game.move({
      from: chosenMove.uci.slice(0, 2),
      to: chosenMove.uci.slice(2, 4),
      promotion: chosenMove.uci[4] || void 0
    });
    if (!result) {
      sendStatus(win, "error", "Bot move invalid");
      return { error: "Bot generated an invalid move" };
    }
    sendStatus(win, "done", `Opponent played ${result.san}`);
    return {
      moveUci: chosenMove.uci,
      moveSan: result.san,
      fen: game.fen()
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendStatus(win, "error", "Bot move failed");
    return { error: msg };
  }
}
function classifyMoveQuality(centipawnLoss) {
  if (centipawnLoss <= 0) return "best";
  if (centipawnLoss <= 10) return "excellent";
  if (centipawnLoss <= 30) return "good";
  if (centipawnLoss <= 80) return "inaccuracy";
  if (centipawnLoss <= 200) return "mistake";
  return "blunder";
}
function buildExplanation(quality, userMoveSan, bestMoveSan, centipawnLoss, bestScoreCp, bestMateIn, userScoreCp, userMateIn, fen, userMoveUci, bestMoveUci) {
  const parts = [];
  const bestEvalStr = bestMateIn !== null ? `mate in ${Math.abs(bestMateIn)}` : bestScoreCp !== null ? `${(bestScoreCp / 100).toFixed(1)}` : "?";
  const userEvalStr = userMateIn !== null ? `mate in ${Math.abs(userMateIn)}` : userScoreCp !== null ? `${(userScoreCp / 100).toFixed(1)}` : "?";
  const lossStr = (centipawnLoss / 100).toFixed(1);
  userMoveSan[0];
  const bestPieceChar = bestMoveSan[0];
  const pieceNames = {
    K: "king",
    Q: "queen",
    R: "rook",
    B: "bishop",
    N: "knight"
  };
  const userIsCapture = userMoveSan.includes("x");
  const bestIsCapture = bestMoveSan.includes("x");
  const userIsCheck = userMoveSan.includes("+") || userMoveSan.includes("#");
  const bestIsCheck = bestMoveSan.includes("+") || bestMoveSan.includes("#");
  const bestIsCastle = bestMoveSan === "O-O" || bestMoveSan === "O-O-O";
  const moveNumber = parseInt(fen.split(" ")[5] || "1");
  const phase = moveNumber <= 10 ? "opening" : moveNumber <= 25 ? "middlegame" : "endgame";
  if (quality === "best") {
    parts.push(`Excellent! ${userMoveSan} is the engine's top choice.`);
    if (userIsCapture && userIsCheck) {
      parts.push(
        "You found the key tactic — capturing with check forces your opponent to respond to the threat while you win material."
      );
    } else if (userIsCheck) {
      parts.push(
        "This check creates a strong initiative. Forcing moves like checks limit your opponent's options."
      );
    } else if (userIsCapture) {
      parts.push(
        "Good eye! You spotted the right capture when it was available."
      );
    } else if (userMoveSan === "O-O" || userMoveSan === "O-O-O") {
      parts.push(
        "Good decision to castle. King safety is crucial, and you connected your rooks."
      );
    } else if (phase === "opening") {
      parts.push(
        "You followed opening principles well — developing pieces and controlling the center."
      );
    } else if (phase === "endgame") {
      parts.push(
        "Well played. In the endgame, precision matters and you found the right move."
      );
    } else {
      parts.push("You identified the strongest continuation in this position.");
    }
    if (userScoreCp !== null) {
      if (userScoreCp > 300) {
        parts.push(
          "You have a winning advantage — stay focused and convert it safely."
        );
      } else if (userScoreCp > 100) {
        parts.push(
          "You have a clear advantage. Keep pressing while avoiding unnecessary complications."
        );
      } else if (userScoreCp > -50) {
        parts.push(
          "The position is roughly equal. Keep looking for small improvements."
        );
      }
    }
    return parts.join(" ");
  }
  if (quality === "excellent") {
    parts.push(
      `${userMoveSan} is nearly perfect — very close to the best move ${bestMoveSan} (eval ${bestEvalStr}).`
    );
    parts.push(`The difference of ${lossStr} pawns is minimal.`);
  } else if (quality === "good") {
    parts.push(
      `${userMoveSan} is solid but ${bestMoveSan} was stronger (eval ${bestEvalStr} vs your ${userEvalStr}).`
    );
  } else if (quality === "inaccuracy") {
    parts.push(
      `${userMoveSan} is an inaccuracy, losing about ${lossStr} pawns of advantage.`
    );
    parts.push(`The best move was ${bestMoveSan} (eval ${bestEvalStr}).`);
  } else if (quality === "mistake") {
    parts.push(`${userMoveSan} is a mistake, costing about ${lossStr} pawns.`);
    parts.push(`${bestMoveSan} was much better (eval ${bestEvalStr}).`);
  } else if (quality === "blunder") {
    parts.push(
      `${userMoveSan} is a serious blunder! You lost ${lossStr} pawns of advantage.`
    );
    parts.push(`${bestMoveSan} was the move to find (eval ${bestEvalStr}).`);
  }
  if (quality !== "excellent") {
    if (bestMateIn !== null && bestMateIn > 0) {
      parts.push(
        `You missed a forced checkmate in ${bestMateIn}. Look for all checks and captures — forcing moves come first!`
      );
    } else if (bestIsCheck && !userIsCheck) {
      parts.push(
        `The best move gives check, which is a forcing move. Always consider checks first — they limit your opponent's responses.`
      );
    } else if (bestIsCapture && !userIsCapture) {
      parts.push(
        `The best move captures material. Before making a quiet move, ask yourself: are there any captures available that improve my position?`
      );
    } else if (bestIsCastle) {
      parts.push(
        `The best move was castling. In this position, king safety was more important than the move you played.`
      );
    } else if (!bestIsCapture && !bestIsCheck) {
      const bestPieceName = pieceNames[bestPieceChar] || (bestPieceChar === bestPieceChar.toLowerCase() ? "pawn" : "piece");
      parts.push(
        `The best move improves the ${bestPieceName}'s position. Sometimes the strongest moves aren't captures — they prepare future threats.`
      );
    }
  }
  if (quality === "mistake" || quality === "blunder") {
    if (userIsCapture && !bestIsCapture) {
      parts.push(
        "Grabbing material isn't always best — sometimes your opponent left that piece hanging to lure you into a worse position. Think about what your opponent's plan is."
      );
    } else if (!userIsCapture && !userIsCheck) {
      parts.push(
        "Before committing to a quiet move, use this checklist: (1) Are my pieces safe? (2) Does my opponent have threats? (3) Are there any tactics I can use?"
      );
    }
    if (phase === "endgame") {
      parts.push(
        "In the endgame, every move counts. Think about pawn promotion, king activity, and piece coordination."
      );
    }
  }
  if (quality === "inaccuracy") {
    if (phase === "opening") {
      parts.push(
        "In the opening, focus on: center control, piece development, king safety. Ask — does my move help any of these?"
      );
    } else {
      parts.push(
        "Ask yourself before each move: what is my opponent threatening, and what does my move accomplish?"
      );
    }
  }
  return parts.join(" ");
}
async function evaluateMove(win, engine, fen, moveUci, moveSan) {
  const settings = getSettings();
  if (!engine.isReady()) {
    return { error: "Engine not ready" };
  }
  sendStatus(win, "analyzing", "Evaluating your move…");
  try {
    const multiPV = Math.max(settings.multiPV, 8);
    const moves = await engine.analyze(fen, settings.analysisDepth, multiPV);
    if (moves.length === 0) {
      sendStatus(win, "done", "No moves to evaluate");
      return { error: "No legal moves in this position" };
    }
    const bestMove = moves[0];
    const userMove = moves.find((m) => m.uci === moveUci);
    let userScoreCp = (userMove == null ? void 0 : userMove.scoreCp) ?? null;
    let userMateIn = (userMove == null ? void 0 : userMove.mateIn) ?? null;
    if (!userMove) {
      const worst = moves[moves.length - 1];
      userScoreCp = (worst.scoreCp ?? 0) - 50;
      userMateIn = null;
    }
    let centipawnLoss = 0;
    if (bestMove.mateIn !== null && bestMove.mateIn > 0) {
      if (userMateIn !== null && userMateIn > 0) {
        centipawnLoss = Math.max(0, (userMateIn - bestMove.mateIn) * 5);
      } else {
        centipawnLoss = 300;
      }
    } else if (bestMove.scoreCp !== null && userScoreCp !== null) {
      centipawnLoss = Math.max(0, bestMove.scoreCp - userScoreCp);
    }
    const quality = classifyMoveQuality(centipawnLoss);
    const explanation = buildExplanation(
      quality,
      moveSan,
      bestMove.san || bestMove.uci,
      centipawnLoss,
      bestMove.scoreCp,
      bestMove.mateIn,
      userScoreCp,
      userMateIn,
      fen,
      moveUci,
      bestMove.uci
    );
    sendStatus(win, "done", `Move evaluated: ${quality}`);
    return {
      userMoveSan: moveSan,
      userMoveUci: moveUci,
      userMoveScoreCp: userScoreCp,
      userMoveMateIn: userMateIn,
      bestMoveSan: bestMove.san || bestMove.uci,
      bestMoveUci: bestMove.uci,
      bestMoveScoreCp: bestMove.scoreCp,
      bestMoveMateIn: bestMove.mateIn,
      quality,
      explanation,
      centipawnLoss
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendStatus(win, "error", "Evaluation failed");
    return { error: msg };
  }
}
function createTray(win, app) {
  let icon;
  try {
    const iconPath = path__namespace.join(app.getAppPath(), "assets", "icon.png");
    icon = electron.nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      icon = createDefaultIcon();
    }
  } catch {
    icon = createDefaultIcon();
  }
  const tray = new electron.Tray(icon);
  tray.setToolTip("Chess Helper Overlay");
  const updateMenu = (isVisible) => {
    const contextMenu = electron.Menu.buildFromTemplate([
      {
        label: "Chess Helper Overlay",
        enabled: false
      },
      { type: "separator" },
      {
        label: isVisible ? "Hide Overlay" : "Show Overlay",
        click: () => {
          if (win.isVisible()) {
            win.hide();
          } else {
            win.show();
          }
          updateMenu(!isVisible);
        }
      },
      { type: "separator" },
      {
        label: "Quit Chess Helper",
        click: () => {
          app.quit();
        }
      }
    ]);
    tray.setContextMenu(contextMenu);
  };
  updateMenu(true);
  tray.on("double-click", () => {
    if (win.isVisible()) {
      win.hide();
    } else {
      win.show();
    }
  });
  win.on("show", () => updateMenu(true));
  win.on("hide", () => updateMenu(false));
  return tray;
}
function createDefaultIcon() {
  return electron.nativeImage.createEmpty();
}
try {
  if (require("electron-squirrel-startup")) {
    electron.app.quit();
  }
} catch {
}
let mainWindow = null;
const engineManager = new EngineManager();
function createWindow() {
  const settings = getSettings();
  const win = new electron.BrowserWindow({
    width: 320,
    height: 700,
    minWidth: 320,
    maxWidth: 320,
    minHeight: 500,
    maxHeight: 1200,
    useContentSize: true,
    x: settings.windowX ?? void 0,
    y: settings.windowY ?? void 0,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path__namespace.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  {
    win.loadURL("http://localhost:5173");
  }
  win.on("moved", () => {
    const [x, y] = win.getPosition();
    const store2 = initStore();
    store2.set("windowX", x);
    store2.set("windowY", y);
  });
  win.on("closed", () => {
    mainWindow = null;
  });
  return win;
}
async function initializeEngine() {
  const settings = getSettings();
  try {
    await engineManager.initialize(settings.stockfishPath || void 0);
    console.log("[Main] Stockfish engine ready");
  } catch (err) {
    console.error("[Main] Failed to initialize Stockfish:", err);
    mainWindow == null ? void 0 : mainWindow.webContents.once("did-finish-load", () => {
      mainWindow == null ? void 0 : mainWindow.webContents.send("status-update", {
        status: "error",
        message: err instanceof Error ? err.message : String(err)
      });
    });
  }
}
electron.app.whenReady().then(async () => {
  initStore();
  mainWindow = createWindow();
  registerIpcHandlers(mainWindow, engineManager);
  createTray(mainWindow, electron.app);
  initializeEngine();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    } else {
      mainWindow == null ? void 0 : mainWindow.show();
    }
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
electron.app.on("will-quit", () => {
  engineManager.shutdown();
});
function getMainWindow() {
  return mainWindow;
}
exports.engineManager = engineManager;
exports.getMainWindow = getMainWindow;
