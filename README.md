# EcoProcess Equipment Suite — Sizing + Factory Costing

Internal engineering tool for **sizing** and **factory costing** of process equipment,
starting with the **ATFE/ATFD** (Agitated Thin Film Evaporator/Dryer). Architecture is
registry-based for extension to Spiral HE, RVPD, SPDU, LLE and others.

## Deploy (GitHub → Vercel)

```bash
# 1. Push to GitHub
git remote add origin https://github.com/<you>/ecoprocess-suite.git
git push -u origin main

# 2. Import the repo at vercel.com/new — zero config needed (Next.js auto-detected).
#    Every push to main auto-deploys.
```

Local dev: `npm install && npm run dev` · Tests: `npx jest` (52 tests, all must pass)

## What's inside

**Sizing (ATFE)** — `lib/engines/atfe.ts`
- Mass & energy balance, Antoine boiling points, Watson latent heats, saturated
  steam table, NaCl BPE correlation, U-value lookup (preliminary) or penetration
  theory (detailed), standard size selection.
- **Multi-solvent mixtures**: ideal-Raoult bubble point + mass-weighted mixture
  properties, with explicit warnings for 14 known azeotropic/non-ideal pairs.
- **Partial evaporation**: Target Concentrate Purity drives the solids balance
  (total volatile removal only when no target is entered).
- **Engineer overrides** (take precedence over all calculation): boiling point,
  distillate latent heat, U-value — matching questionnaire field practice.
- Results display the Coulson & Richardson Vol. 6 non-agitated vaporiser analogue
  next to the selected U so the agitated-film premium is a visible, owned decision.

**Costing (ATFE)** — `lib/costing/`
- Weight-buildup model implementing the EcoProcess Excel formulas **verbatim**
  (formula provenance documented in `lib/costing/rates.ts`): geometry from area,
  17 component weights, ₹/kg by MOC, machining, weight-based and %-based
  overheads, bought-outs, fixed cost, and a separate management margin layer.
- **Validated**: reproduces the Thermax 7.5 m² Duplex costing sheet total
  (₹17,63,997) within 1%, line by line.
- All rates are editable config with source citations and the engineering team's
  open questions flagged (`⚠` in rates.ts) — resolve those before quoting.

## Validation status (read this before trusting numbers)

| Layer | Status |
|---|---|
| Thermo fundamentals (Antoine, Watson, steam, balances) | Test-locked vs literature anchors |
| Mixture bubble points | Ideal-solution; warns on non-ideal pairs; override field for measured BPs |
| U-values | **Uncalibrated defaults.** C&R analogue shown; engineer override provided. Back-test against real EcoProcess jobs pending (needs duty↔area pairs for past ATFE/ATFD supplies) |
| Costing model | Reproduces Thermax sheet ±1%; rate open questions flagged in rates.ts |

## Extending to new equipment

See `lib/equipment/registry.ts` for the pattern and the non-negotiable bar:
**no engine ships without a validation test against a real sized/quoted job.**
Validation source documents received so far: HTRI S&T datasheets (10 exchangers,
for the future Spiral/S&T module), PI Industries SHE costing (7-point size ladder),
Zeppelin RVPD, IDHMA SPDU, Sahithi MEE+ATFD.

## Specification

`ATFE_SPECIFICATION_v2.md` (+ addenda) is the source of truth for the sizing model.
If code and spec disagree, one of them is wrong — fix it, don't work around it.
