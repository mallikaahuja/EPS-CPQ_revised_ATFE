// Pilot Run Storage and Scale-Up — Phase 7.
//
// Before this file existed there was NO pilot data input path anywhere in the
// repo: `pilotTriggers` (sanity.ts) is a list of strings telling the engineer
// to go run a pilot, with nowhere to put the result when they come back. Every
// U in the system was an uncalibrated lookup, a broken correlation, or a bare
// override with no provenance. This is what makes those duty↔area pairs usable
// (README: U back-testing "pending, needs duty↔area pairs").
//
// Persistence follows the same pattern as lib/costing/rates-store.ts: editable
// config, persisted to localStorage, deep-mergeable across schema versions.

import type { MOC } from './materials';
import type { RotorTypeId } from './rotors';
import type { HeatingMedium } from '@/lib/types';
import type { JacketType } from './heating-media';
import { MOC_PROPERTIES } from './materials';
import { computeHOuter } from './heating-media';

export interface PilotRun {
  id: string;
  productName: string;
  date: string;
  // measured — either U directly, or duty+area+lmtd to derive it
  measuredU_W_m2K?: number;
  duty_kW?: number;
  area_m2: number;
  lmtd_C: number;
  // pilot machine configuration — REQUIRED to invert correctly; a pilot U is
  // only meaningful together with the hardware it was measured on.
  bodyId?: string;
  D_rotor_m: number;
  rotorType: RotorTypeId;
  bladeCount: number;
  rpm: number;
  wallThickness_mm: number;
  moc: MOC;
  heatingMedium: HeatingMedium;
  jacketType: JacketType;
  h_outer_W_m2K?: number; // if known/measured directly; else derived from heatingMedium+jacketType
  jacketMeanTemp_C?: number; // needed to derive h_outer when h_outer_W_m2K is not given
  // product state at pilot conditions
  viscosity_cP: number;
  viscosityBasis: 'feed' | 'concentrate' | 'mean';
  solidsIn_pct: number;
  solidsOut_pct: number;
  foulingAssumed_m2KW?: number;
}

/**
 * Invert a measured pilot U back to the implied inner film coefficient, given
 * the pilot machine's own wall, MOC, and jacket. Throws when the measured U is
 * physically impossible for the stated hardware (R_film <= 0) — this doubles
 * as a data-quality check on historical pilot/plant records, not just a
 * calculation step.
 */
export function invertPilotToFilmCoeff(p: PilotRun): number {
  const U = p.measuredU_W_m2K ?? (p.duty_kW != null ? (p.duty_kW * 1000) / (p.area_m2 * p.lmtd_C) : NaN);
  if (!Number.isFinite(U) || U <= 0) {
    throw new Error(`Pilot run "${p.productName}" (${p.id}): no usable U — supply measuredU_W_m2K, or duty_kW + area_m2 + lmtd_C.`);
  }

  const h_o = p.h_outer_W_m2K ??
    (p.jacketMeanTemp_C != null
      ? computeHOuter(p.heatingMedium, p.jacketType, p.jacketMeanTemp_C)
      : NaN);
  if (!Number.isFinite(h_o) || h_o <= 0) {
    throw new Error(`Pilot run "${p.productName}" (${p.id}): cannot determine jacket h_outer — supply h_outer_W_m2K or jacketMeanTemp_C.`);
  }

  const R_w = (p.wallThickness_mm / 1000) / MOC_PROPERTIES[p.moc].k_W_mK;
  const R_f = (p.foulingAssumed_m2KW ?? 0.0002) * 2; // inner + outer fouling, same default as getFoulingFactor('low')

  const R_film = 1 / U - 1 / h_o - R_w - R_f;
  if (R_film <= 0) {
    throw new Error(
      `Pilot inversion failed for "${p.productName}" (${p.id}): measured U (${U.toFixed(0)} W/m²·K) exceeds ` +
      `what the wall (${(R_w * 1000).toFixed(3)}×10⁻³ m²K/W) and jacket (h_o=${h_o.toFixed(0)}) alone permit. ` +
      `Check wall thickness, MOC, jacket coefficient, or the measured U itself.`
    );
  }
  return 1 / R_film;
}

/**
 * Scale a pilot-derived film coefficient to full scale: h_i,2 = f · h_i,1.
 *
 * ⚠ `f` MUST be fitted from EcoProcess pilot-to-plant pairs — it is NOT
 * hardcoded here, and no default is supplied. `f` is generally below 1 (full
 * scale under-performs the pilot: distribution quality, wall tolerance, and
 * edge effects all degrade with size) but the magnitude is geometry- and
 * product-specific. Until at least three pilot-to-plant pairs exist, the
 * caller must supply `f` explicitly (see ATFE_SPECIFICATION_v2.md Phase 7) —
 * there is deliberately no fallback value here.
 */
export function scaleUpFilmCoeff(h_i_pilot: number, f: number): number {
  if (!(f > 0)) throw new Error(`Scale-up factor f must be a positive number (got ${f}). It must be fitted from pilot-to-plant data — see Appendix A6.`);
  return f * h_i_pilot;
}

// --- Storage (localStorage, same pattern as lib/costing/rates-store.ts) ---

export const PILOT_RUNS_STORAGE_KEY = 'ecoprocess.atfe.pilotRuns.v1';

export function loadPilotRuns(): PilotRun[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PILOT_RUNS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePilotRuns(runs: PilotRun[]): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(PILOT_RUNS_STORAGE_KEY, JSON.stringify(runs));
    return true;
  } catch {
    return false;
  }
}

export function upsertPilotRun(run: PilotRun): PilotRun[] {
  const runs = loadPilotRuns();
  const idx = runs.findIndex(r => r.id === run.id);
  if (idx >= 0) runs[idx] = run; else runs.push(run);
  savePilotRuns(runs);
  return runs;
}

export function findPilotRunsForProduct(productName: string): PilotRun[] {
  return loadPilotRuns().filter(r => r.productName.toLowerCase() === productName.toLowerCase());
}
