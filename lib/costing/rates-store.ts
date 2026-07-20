// Engineering-owned rates store.
//
// Rates change (steel prices, vendor rates, FY rate cards) without code releases,
// so the complete rate configuration is editable in the UI and persisted in the
// browser's localStorage. Design notes:
//  - Saved values are DEEP-MERGED over the calibrated defaults, so adding new rate
//    fields in future code versions never breaks older saved configs.
//  - Export/Import JSON lets engineering share one config across the team and keep
//    a copy in version control. localStorage is per-browser: the exported JSON (or
//    a checked-in rates file) is the team's source of truth, not the browser.
//  - "Reset to calibrated defaults" restores the Thermax-validated values.

import {
  DEFAULT_MOC_RATES, DEFAULT_THICKNESS, DEFAULT_JOB_RATES, DEFAULT_OVERHEADS,
  DEFAULT_BOUGHT_OUTS, DEFAULT_GEOMETRY,
  type MOCRates, type ThicknessConfig, type JobRates, type OverheadRates,
  type BoughtOutItem, type GeometryConfig,
} from './rates';

export interface RatesConfig {
  version: number;
  mocRates: MOCRates;
  thickness: ThicknessConfig;
  jobRates: JobRates;
  overheads: OverheadRates;
  boughtOuts: BoughtOutItem[];
  geometry: GeometryConfig;
}

export const RATES_STORAGE_KEY = 'ecoprocess.atfe.rates.v1';

export function getDefaultRatesConfig(): RatesConfig {
  return {
    version: 1,
    mocRates: { ...DEFAULT_MOC_RATES },
    thickness: { ...DEFAULT_THICKNESS },
    jobRates: { ...DEFAULT_JOB_RATES },
    overheads: { ...DEFAULT_OVERHEADS },
    boughtOuts: DEFAULT_BOUGHT_OUTS.map(b => ({ ...b })),
    geometry: { ...DEFAULT_GEOMETRY },
  };
}

// Deep-merge a (possibly partial / older-version) saved config over defaults.
// Arrays (boughtOuts) are replaced wholesale — item lists are edited as a unit.
export function mergeRatesConfig(saved: unknown): RatesConfig {
  const d = getDefaultRatesConfig();
  if (saved == null || typeof saved !== 'object') return d;
  const s = saved as Partial<RatesConfig>;
  return {
    version: d.version,
    mocRates: { ...d.mocRates, ...(s.mocRates ?? {}) },
    thickness: { ...d.thickness, ...(s.thickness ?? {}) },
    jobRates: { ...d.jobRates, ...(s.jobRates ?? {}) },
    overheads: { ...d.overheads, ...(s.overheads ?? {}) },
    boughtOuts: Array.isArray(s.boughtOuts)
      ? s.boughtOuts
          .filter(b => b && typeof b.name === 'string' && typeof b.cost === 'number')
          .map(b => ({ name: b.name, cost: b.cost }))
      : d.boughtOuts,
    geometry: { ...d.geometry, ...(s.geometry ?? {}) },
  };
}

export function loadRatesConfig(): RatesConfig {
  if (typeof window === 'undefined') return getDefaultRatesConfig();
  try {
    const raw = window.localStorage.getItem(RATES_STORAGE_KEY);
    if (!raw) return getDefaultRatesConfig();
    return mergeRatesConfig(JSON.parse(raw));
  } catch {
    return getDefaultRatesConfig();
  }
}

export function saveRatesConfig(cfg: RatesConfig): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(RATES_STORAGE_KEY, JSON.stringify(cfg));
    return true;
  } catch {
    return false;
  }
}

export function resetRatesConfig(): RatesConfig {
  if (typeof window !== 'undefined') {
    try { window.localStorage.removeItem(RATES_STORAGE_KEY); } catch { /* noop */ }
  }
  return getDefaultRatesConfig();
}

export function exportRatesJSON(cfg: RatesConfig): string {
  return JSON.stringify(cfg, null, 2);
}

export function importRatesJSON(json: string): RatesConfig {
  return mergeRatesConfig(JSON.parse(json)); // throws on invalid JSON — caller handles
}
