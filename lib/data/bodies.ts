// ATFE Body Registry — Phase 1 of the sizing remediation (see ATFE_SPECIFICATION_v2.md).
//
// Replaces the old `STANDARD_SIZES: number[]` ladder (u-ranges.ts) and the
// hardcoded `L_D_ratio = 7` / `N_rpm = 300` in lib/engines/atfe.ts. Geometry now
// comes from a real machine, never from a formula back-derived off the required
// area.
//
// ⚠ PROVENANCE: only the ATFE-10 entry is anchored to a real machine — the
// engineering team's "High viscosity polymer concentration" sample configuration
// (D=800mm, L_rotor=4.4m, heated area=10 m², SS316, ASME Sec VIII Div I). EVERY
// OTHER ENTRY IS AN INTERPOLATED PLACEHOLDER built by holding the anchor's rotor
// L/D (5.5) and heated-length fraction (90% of rotor) constant across the ladder:
//   D_rotor    = sqrt(heatedArea / (π · 0.90 · 5.5))
//   L_rotor    = 5.5 · D_rotor
//   L_heated   = 0.90 · L_rotor        (=> π·D·L_heated = heatedArea, exactly)
// This reproduces the anchor to within rounding (D=0.802 vs the real 0.800) but
// has NOT been checked against any other actual EcoProcess GA drawing. Replace
// with real dimension tables per Appendix A1 before this ladder is used to quote
// anything outside the 10 m² frame.
//
// nominalArea_m2 vs heatedArea_m2 (Appendix A9): the vendor's own "ATFE-10"
// designation and its quoted heat-transfer area are both 10 m² for the anchor,
// so nominal = heated is used here. It is NOT confirmed whether EcoProcess
// datasheets elsewhere name a body by heated area or by the full-rotor wetted
// potential (for the anchor that would be π·0.8·4.4 = 11.06 m², ~10.6% higher).
// If that convention differs, every selection below is one size optimistic.
// Confirm with engineering before trusting nominalArea_m2 for anything.

import type { MOC } from './materials';
import type { RotorTypeId } from './rotors';

export interface ATFEBody {
  id: string;                      // e.g. 'ATFE-10'
  nominalArea_m2: number;          // catalogue / marketing area
  heatedArea_m2: number;            // ACTUAL wetted heat transfer area — sizing uses this
  D_rotor_m: number;
  L_rotor_m: number;                // full rotor including distributor + separation section
  L_heated_m: number;                // heatedArea / (π · D)
  shellID_m: number;                // for vapour velocity check (Phase 8.5, not yet enforced)
  freeVapourAreaFraction: number;   // ⚠ PLACEHOLDER 0.55 — measure from GA drawings
  wallThickness_mm: Record<MOC, number>; // from pressure design per body & MOC (⚠ placeholder, see below)
  minFeed_kgh: number;              // = heatedArea × 50 kg/h·m² (Phase 8.1 loading floor; not yet enforced)
  maxFeed_kgh: number;              // = heatedArea × 1000 kg/h·m²
  compatibleRotors: RotorTypeId[];
}

const D_ANCHOR = 0.800;
const L_ROTOR_ANCHOR = 4.40;
const L_HEATED_ANCHOR = 3.98; // 10 / (π · 0.800)
const ROTOR_LD_RATIO = 5.5;        // anchor: 4.4 / 0.8 = 5.5
const HEATED_LENGTH_FRACTION = 0.90; // anchor: 3.98 / 4.4 ≈ 0.905

// ⚠ PLACEHOLDER — reference wall thickness (mm) at the D=0.800 m anchor, by MOC.
// Not measured; ordered by relative ASME allowable stress at the sample's design
// temperature class (duplex/super-duplex thinner than austenitic SS for the same
// pressure rating; titanium and Alloy 20 thicker). Needs pressure-design
// calculation per body & MOC — Appendix A1.
const REFERENCE_WALL_MM_AT_ANCHOR: Record<MOC, number> = {
  SS304: 12,
  SS316: 10,
  SS316L: 10,
  Duplex2205: 8,
  SuperDuplex2507: 8,
  Alloy20: 11,
  HastelloyC276: 9,
  Titanium: 12,
  Nickel200: 10,
};

function wallThicknessTable(D_rotor_m: number): Record<MOC, number> {
  const out = {} as Record<MOC, number>;
  for (const moc of Object.keys(REFERENCE_WALL_MM_AT_ANCHOR) as MOC[]) {
    // Thin-wall pressure vessel theory: t ∝ D for constant design pressure / allowable stress.
    const scaled = REFERENCE_WALL_MM_AT_ANCHOR[moc] * (D_rotor_m / D_ANCHOR);
    out[moc] = Math.max(6, Math.round(scaled * 2) / 2); // round to 0.5 mm, 6 mm fabrication floor
  }
  return out;
}

function buildBody(heatedArea_m2: number, isAnchor: boolean): ATFEBody {
  const D_rotor_m = isAnchor
    ? D_ANCHOR
    : Math.sqrt(heatedArea_m2 / (Math.PI * HEATED_LENGTH_FRACTION * ROTOR_LD_RATIO));
  const L_rotor_m = isAnchor ? L_ROTOR_ANCHOR : ROTOR_LD_RATIO * D_rotor_m;
  const L_heated_m = isAnchor ? L_HEATED_ANCHOR : HEATED_LENGTH_FRACTION * L_rotor_m;

  return {
    id: `ATFE-${heatedArea_m2}`,
    nominalArea_m2: heatedArea_m2,
    heatedArea_m2,
    D_rotor_m,
    L_rotor_m,
    L_heated_m,
    shellID_m: D_rotor_m + 0.05, // ⚠ PLACEHOLDER — typical annular gap allowance; measure from GA drawings
    freeVapourAreaFraction: 0.55, // ⚠ PLACEHOLDER — measure from GA drawings (Phase 8.5)
    wallThickness_mm: wallThicknessTable(D_rotor_m),
    minFeed_kgh: heatedArea_m2 * 50,
    maxFeed_kgh: heatedArea_m2 * 1000,
    compatibleRotors: ['fixed_rigid', 'hinged_pivoted', 'roller_wiper', 'contact_wiper'], // ⚠ narrow per Appendix A2/A4 once confirmed with engineering
  };
}

// Same nominal ladder as the old STANDARD_SIZES — kept identical so Phase 1 does
// not, by itself, change which size a given A_required lands on. What changes is
// the geometry (and, from Phase 3 onward, the physics) behind each entry.
const LADDER_AREAS = [0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 6.0, 8.0, 10.0, 12.0, 15.0, 20.0];

export const BODY_REGISTRY: ATFEBody[] = LADDER_AREAS.map(a => buildBody(a, a === 10.0));

export type SelectBodyResult =
  | { body: ATFEBody; exceeded: false }
  | { body: null; exceeded: true; minUnits: number; largest: ATFEBody };

/**
 * Select the smallest body whose heated area covers A_required. Returns a
 * discriminated result rather than silently clamping to the largest body —
 * the old `selectStandardSize` returned the 20 m² entry for any A_required
 * above it, which fed a negative overdesign_pct into a sanity check that could
 * only ever report 'warning', never 'fail' (see ATFE_SPECIFICATION_v2.md Phase 0.1).
 */
export function selectBody(A_required: number, bodyOverride?: string): SelectBodyResult {
  if (bodyOverride) {
    const forced = BODY_REGISTRY.find(b => b.id === bodyOverride);
    if (forced) return { body: forced, exceeded: false };
    // fall through to normal selection if the override id is unknown
  }
  const largest = BODY_REGISTRY[BODY_REGISTRY.length - 1];
  if (A_required > largest.heatedArea_m2) {
    return { body: null, exceeded: true, minUnits: Math.ceil(A_required / largest.heatedArea_m2), largest };
  }
  const body = BODY_REGISTRY.find(b => b.heatedArea_m2 >= A_required)!;
  return { body, exceeded: false };
}

export function getBodyById(id: string): ATFEBody | undefined {
  return BODY_REGISTRY.find(b => b.id === id);
}
