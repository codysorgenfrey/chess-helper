import Store from 'electron-store';
import {
  AppSettings,
  CalibrationData,
  DEFAULT_SETTINGS,
} from '../shared/types';

interface StoreSchema {
  captureHotkey: string;
  sideToMove: 'w' | 'b';
  analysisDepth: number;
  multiPV: number;
  stockfishPath: string;
  windowOpacity: number;
  windowX: number | null;
  windowY: number | null;
  castlingRights: string;
  calibration: CalibrationData | null;
}

let store: Store<StoreSchema> | null = null;

export function initStore(): Store<StoreSchema> {
  if (!store) {
    store = new Store<StoreSchema>({
      defaults: {
        ...DEFAULT_SETTINGS,
        calibration: null,
      } as StoreSchema,
      name: 'chess-helper-settings',
    });
  }
  return store;
}

export function getSettings(): AppSettings {
  const s = initStore();
  return {
    captureHotkey: s.get('captureHotkey', DEFAULT_SETTINGS.captureHotkey),
    sideToMove: s.get('sideToMove', DEFAULT_SETTINGS.sideToMove),
    analysisDepth: s.get('analysisDepth', DEFAULT_SETTINGS.analysisDepth),
    multiPV: s.get('multiPV', DEFAULT_SETTINGS.multiPV),
    stockfishPath: s.get('stockfishPath', DEFAULT_SETTINGS.stockfishPath),
    windowOpacity: s.get('windowOpacity', DEFAULT_SETTINGS.windowOpacity),
    windowX: s.get('windowX', DEFAULT_SETTINGS.windowX),
    windowY: s.get('windowY', DEFAULT_SETTINGS.windowY),
    castlingRights: s.get('castlingRights', DEFAULT_SETTINGS.castlingRights),
  };
}

export function saveSettings(partial: Partial<AppSettings>): AppSettings {
  const s = initStore();
  const current = getSettings();
  const updated = { ...current, ...partial };
  (Object.keys(updated) as (keyof AppSettings)[]).forEach((key) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    s.set(key, updated[key] as any);
  });
  return updated;
}

// ── Calibration persistence ───────────────────────────────────────────────────

export function getCalibration(): CalibrationData | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (initStore().get('calibration', null) as any) ?? null;
  // Guard against old-format calibration data (pre-template era).
  // The new format uses a `templates` array; the old one had `lightSquare` etc.
  if (raw && !Array.isArray(raw.templates)) {
    console.warn('[Store] Discarding incompatible legacy calibration data');
    initStore().set('calibration', null as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    return null;
  }
  return raw;
}

export function saveCalibration(data: CalibrationData): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initStore().set('calibration', data as any);
}

export function clearCalibration(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initStore().set('calibration', null as any);
}
