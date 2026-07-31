// Materials of Construction — Phase 2 of the sizing remediation.
//
// SINGLE SOURCE OF TRUTH for MOC identifiers, shared by the thermal engine
// (lib/engines/atfe.ts — needs k_W_mK for the wall resistance term) and the
// costing engine (lib/costing/rates.ts — needs the same string as a ₹/kg rate
// key). Before this file existed, sizing hardcoded SS316/k=16 unconditionally
// while costing's contactMOC was a free string entered independently in
// CostingPanel.tsx — a quote could price Duplex and thermally size SS316 at the
// same time. See ATFE_SPECIFICATION_v2.md Phase 2.
//
// The identifier strings below intentionally match the costing rate-table keys
// in lib/costing/rates.ts (DEFAULT_MOC_RATES) exactly where they already
// existed (SS304, SS316, SS316L, Duplex2205) so that a single MOC value can
// drive both ₹/kg lookup and k_W_mK lookup without a translation layer.

export type MOC =
  | 'SS304'
  | 'SS316'
  | 'SS316L'
  | 'Duplex2205'
  | 'SuperDuplex2507'
  | 'Alloy20'
  | 'HastelloyC276'
  | 'Titanium'
  | 'Nickel200';

export interface MOCProps {
  k_W_mK: number;
  source: string;
}

// Thermal conductivity at ~100°C (mid-range process temperature). ASME BPVC
// Section II-D values vary modestly with temperature (typically -10% to +5%
// across 20-300°C for these alloys); using a single representative value here
// is consistent with the rest of the model's precision. Revisit if a specific
// job runs at a temperature extreme where this matters (e.g. >300°C hot oil).
export const MOC_PROPERTIES: Record<MOC, MOCProps> = {
  SS304:           { k_W_mK: 16.2, source: 'ASME BPVC II-D, Table TCD, Group 1 (austenitic SS)' },
  SS316:           { k_W_mK: 16.3, source: 'ASME BPVC II-D, Table TCD, Group 1 (austenitic SS)' },
  SS316L:          { k_W_mK: 16.3, source: 'ASME BPVC II-D, Table TCD, Group 1 (austenitic SS)' },
  Duplex2205:      { k_W_mK: 19.0, source: 'ASME BPVC II-D, Table TCD (duplex UNS S32205)' },
  SuperDuplex2507: { k_W_mK: 20.0, source: 'ASME BPVC II-D, Table TCD (super duplex UNS S32750) — ⚠ PLACEHOLDER, confirm exact grade value' },
  Alloy20:         { k_W_mK: 12.1, source: 'ASME BPVC II-D, Table TCD (Alloy 20 / UNS N08020)' },
  HastelloyC276:   { k_W_mK: 10.1, source: 'Haynes International C-276 datasheet' },
  Titanium:        { k_W_mK: 21.9, source: 'ASME BPVC II-D, Table TCD (Grade 2 titanium)' },
  Nickel200:       { k_W_mK: 70.2, source: 'ASME BPVC II-D, Table TCD (Nickel 200) — ⚠ PLACEHOLDER, verify against alloy 200 vs 201' },
};

// Options as they must appear in the UI (components/AtfeForm.tsx, Section 6) and
// as they key into lib/costing/rates.ts's MOCRates. Labels are the customary
// trade names; values are the canonical MOC identifiers above.
export const MOC_OPTIONS: { value: MOC; label: string }[] = [
  { value: 'SS304', label: 'SS304' },
  { value: 'SS316', label: 'SS316' },
  { value: 'SS316L', label: 'SS316L' },
  { value: 'Duplex2205', label: 'Duplex 2205' },
  { value: 'SuperDuplex2507', label: 'Super Duplex 2507' },
  { value: 'Alloy20', label: 'Alloy 20' },
  { value: 'HastelloyC276', label: 'Hastelloy C276' },
  { value: 'Titanium', label: 'Titanium' },
  { value: 'Nickel200', label: 'Nickel 200' },
];

export function isMOC(value: string | undefined | null): value is MOC {
  return !!value && value in MOC_PROPERTIES;
}
