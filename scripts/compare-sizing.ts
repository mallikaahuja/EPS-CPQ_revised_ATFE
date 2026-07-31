// Single-point vs. zone-march sizing comparison — ATFE_SIZING_FIX_SPEC.md,
// "NEW" item under Phase 5. Phase 5 deliberately kept the pre-remediation
// single-point calculation reachable behind `sizingMethod: 'single_point'`
// specifically so past quotes could be re-run both ways and the team could
// see how far off the historical numbers were. This script is that A/B run.
//
// Usage:
//   npx tsx scripts/compare-sizing.ts [path/to/fixture.json]
//   (defaults to scripts/fixtures/sample-jobs.json if no path is given)
//
// npm script (see package.json): `npm run compare-sizing -- path/to/fixture.json`
//
// --- Fixture format ---
// A JSON file with a top-level `jobs` array. Each entry:
//   {
//     "name": string,                          // shown in the table
//     "mode": "preliminary" | "detailed",       // which calculateATFE mode to run
//     "inputs": Partial<ATFEInputs>             // merged onto DEFAULT_INPUTS below
//   }
// Only specify fields in `inputs` that differ from DEFAULT_INPUTS (feedRate,
// solventType, viscosity, heating medium, BPE source, etc.) — boilerplate
// fields (industry, application, requirement, feedForm, heatSensitivity,
// maxAllowableProductTemp, ...) come from the defaults so real past-job
// fixtures can stay short. Any `sizingMethod` set on `inputs` is IGNORED —
// this script always runs both 'single_point' and 'zone_march' explicitly,
// since that comparison is the entire point.
//
// To paste in real past jobs: copy scripts/fixtures/sample-jobs.json, replace
// the `inputs` blocks with the actual quote inputs (feed rate, composition,
// viscosity, heating medium, operating pressure, BPE), and point this script
// at the new file.

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { calculateATFE } from '../lib/engines/atfe';
import type { ATFEInputs } from '../lib/types';

const DEFAULT_INPUTS: ATFEInputs = {
  industry: 'Chemical',
  application: 'Concentration',
  requirement: 'New Equipment',
  feedMaterialName: 'Unnamed feed',
  feedForm: 'solution',
  feedRate: 1000,
  volatilePercent: 80,
  nonVolatilePercent: 20,
  solventType: 'Water',
  heatSensitivity: 'not_sensitive',
  maxAllowableProductTemp: 200,
  operatingPressure: 1013,
  pressureUnit: 'mbar_a',
  heatingMedium: 'steam',
  hotMediumTemp: 120,
  bpeSource: 'not_applicable',
};

interface FixtureJob {
  name: string;
  mode: 'preliminary' | 'detailed';
  inputs: Partial<ATFEInputs>;
}

interface Fixture {
  jobs: FixtureJob[];
}

function loadFixture(path: string): Fixture {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as Fixture;
  if (!Array.isArray(parsed.jobs) || parsed.jobs.length === 0) {
    throw new Error(`Fixture at ${path} has no "jobs" array, or it is empty.`);
  }
  return parsed;
}

// Heuristic, not a rigorous attribution — see ATFE_SIZING_FIX_SPEC.md Phase 5's
// "Honest limitation to record in the spec document": the single-point and
// zone-march paths already share the SAME Phase 1-4 physics (geometry, MOC,
// jacket, film model) evaluated at feed conditions; the only structural
// difference between them is Phase 5 (marching itself) and, within the march,
// Phase 6 (outlet-basis viscosity and rising BPE). This function distinguishes
// which of those two dominated the delta for a given job's zone profile —
// it does not claim to isolate Phases 1-4 individually, since both runs use
// them identically.
function likelyDriver(profile: ReturnType<typeof calculateATFE>['profile']): string {
  if (!profile || profile.length < 2) return 'Phase 5 (zone marching)';
  const first = profile[0];
  const last = profile[profile.length - 1];
  const viscRatio = first.mu_local_cP > 0 ? last.mu_local_cP / first.mu_local_cP : 1;
  const bpeRise = last.BPE_local_C - first.BPE_local_C;
  const drivers: string[] = [];
  if (viscRatio > 3) drivers.push('Phase 6.1 (outlet-basis viscosity)');
  if (bpeRise > 1) drivers.push('Phase 6.2 (rising BPE / superheat)');
  if (drivers.length === 0) return 'Phase 5 (zone marching — duty distribution)';
  return drivers.join(' + ');
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}
function padNum(n: number, width: number, digits = 2): string {
  const s = Number.isFinite(n) ? n.toFixed(digits) : 'n/a';
  return s.length >= width ? s : ' '.repeat(width - s.length) + s;
}

function main() {
  const fixturePath = resolve(process.cwd(), process.argv[2] ?? 'scripts/fixtures/sample-jobs.json');
  const fixture = loadFixture(fixturePath);

  console.log(`Sizing comparison — single-point vs. zone-march (ATFE_SIZING_FIX_SPEC.md Phase 5)`);
  console.log(`Fixture: ${fixturePath}\n`);

  const colJob = 46, colArea = 10, colDelta = 8;
  console.log(
    pad('Job', colJob) + ' | ' +
    pad('SP A_req', colArea) + ' | ' + pad('SP sel', colArea) + ' | ' +
    pad('ZM A_req', colArea) + ' | ' + pad('ZM sel', colArea) + ' | ' +
    pad('Δ%', colDelta) + ' | Likely driver'
  );
  console.log('-'.repeat(colJob + 3 * (colArea + 3) + colArea + colDelta + 20));

  for (const job of fixture.jobs) {
    const inputs: ATFEInputs = { ...DEFAULT_INPUTS, ...job.inputs };

    const single = calculateATFE({ ...inputs, sizingMethod: 'single_point' }, job.mode);
    const march = calculateATFE({ ...inputs, sizingMethod: 'zone_march' }, job.mode);

    const deltaPct = single.A_required > 0
      ? ((march.A_required - single.A_required) / single.A_required) * 100
      : NaN;

    console.log(
      pad(job.name, colJob) + ' | ' +
      padNum(single.A_required, colArea) + ' | ' + padNum(single.A_selected, colArea) + ' | ' +
      padNum(march.A_required, colArea) + ' | ' + padNum(march.A_selected, colArea) + ' | ' +
      padNum(deltaPct, colDelta, 1) + ' | ' + likelyDriver(march.profile)
    );

    if (single.errors.length > 0 || march.errors.length > 0) {
      for (const e of new Set([...single.errors, ...march.errors])) {
        console.log(`    ! ${e}`);
      }
    }
  }

  console.log(
    `\nSP = single_point (pre-remediation behavior, Phase 5 kept it reachable for exactly this comparison). ` +
    `ZM = zone_march (default since Phase 5). "A_req" is required area (m²); "sel" is the selected standard body (m²). ` +
    `"Likely driver" is a heuristic (see the comment in this script), not a rigorous phase attribution.`
  );
}

main();
