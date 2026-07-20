// Equipment registry — the extension point for adding new equipment types.
//
// Pattern for adding equipment (e.g. Spiral HE, RVPD, SPDU, LLE):
//   1. lib/engines/<type>.ts       — sizing engine (pure function, inputs → results)
//   2. lib/costing/<type>/         — costing rates.ts (with provenance!) + engine.ts
//   3. __tests__/                  — validation tests against a REAL quoted/sized job
//                                     BEFORE the UI exists. No validation data = not ready.
//   4. components/<Type>App.tsx    — form + results + costing tab
//   5. Register here; app/page.tsx renders from this registry.
//
// Rule inherited from ATFE development: physics engines are test-locked against the
// specification's hand-computed cases; costing engines are test-locked against real
// costing sheets (Thermax 7.5 m² reproduced ±1%). Follow the same bar.

import { calculateATFE } from '@/lib/engines/atfe';
import { calculateATFECosting } from '@/lib/costing/engine';

export const EQUIPMENT_REGISTRY = {
  atfe: {
    label: 'Agitated Thin Film Evaporator / Dryer (ATFE / ATFD)',
    sizing: calculateATFE,
    costing: calculateATFECosting,
    status: 'active' as const,
  },
  // spiralHE: { label: 'Spiral Heat Exchanger', ... status: 'planned' },
  // rvpd:     { label: 'Rotary Vacuum Paddle Dryer', ... status: 'planned' },
  // spdu:     { label: 'Short Path Distillation Unit', ... status: 'planned' },
} as const;

export type EquipmentKey = keyof typeof EQUIPMENT_REGISTRY;
