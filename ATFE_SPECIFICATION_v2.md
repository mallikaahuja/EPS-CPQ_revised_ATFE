# EcoProcess ATFE Sizing Calculator — Build Specification

## What To Build

A Next.js web app that sizes Agitated Thin Film Evaporators (ATFE). Two modes: Preliminary (quick estimate using lookup tables) and Detailed (full engineering calculation using correlations). The app takes process inputs from the engineer, runs the calculations, displays results with sanity checks, and generates a PDF datasheet.

Deploy on Vercel via GitHub (same workflow as the cost configurator). No authentication needed — private URL only.

### Deployment Workflow
1. Initialize a Git repo in the project root
2. Create a GitHub repository (e.g., `ecoprocess-atfe`)
3. Push code to GitHub
4. Connect the GitHub repo to Vercel (vercel.com → New Project → Import from GitHub)
5. Every push to `main` auto-deploys to production

This is the same pattern used for the EcoProcess cost configurator. Do NOT run a local-only dev server as the final deployment — local `npm run dev` is for testing only.

---

## Tech Stack

- Next.js 14+ (App Router)
- React with TypeScript
- Tailwind CSS + shadcn/ui for components
- react-pdf or @react-pdf/renderer for PDF generation (server-side)
- No database — all calculations are stateless

---

## Project Structure

```
ecoprocess-atfe/
├── app/
│   ├── layout.tsx          # Shell: EcoProcess branding, dark green header
│   ├── page.tsx            # ATFE sizing form + results
│   └── api/
│       └── generate-pdf/
│           └── route.ts    # PDF datasheet endpoint
├── lib/
│   ├── engines/
│   │   ├── atfe.ts         # ATFE sizing engine (both modes)
│   │   ├── lmtd.ts         # LMTD calculator with BPE correction
│   │   ├── units.ts        # Unit conversion
│   │   └── sanity.ts       # Sanity checks and warnings
│   ├── data/
│   │   ├── solvents.ts     # Solvent property database (21 solvents)
│   │   ├── steam.ts        # Saturated steam table
│   │   └── u-ranges.ts     # U-value lookup ranges for ATFE
│   └── types.ts            # TypeScript interfaces
├── components/
│   ├── AtfeForm.tsx         # Main input form with all sections
│   ├── ResultsPanel.tsx     # Calculation results display
│   ├── SanityChecks.tsx     # Pass/fail/warning indicators
│   └── ModeToggle.tsx       # Preliminary ↔ Detailed switch
└── public/
    └── ecoprocess-logo.svg  # (placeholder — can be replaced later)
```

---

## Design Philosophy

This tool must feel like a guided form, not a software product. The user experience is: **Input → Calculate → Datasheet. Three clicks.** Engineers are comfortable with Excel — this must be simpler, not more complex. Every screen, toggle, and interaction must serve the calculation. No feature bloat.

---

## The ATFE Sizing Form

### Section 1: Application Details

| Field | Type | Options / Unit | Required |
|-------|------|----------------|----------|
| Industry | Dropdown | Pharmaceutical/API, Chemical, Fine Chemical, Petrochemical, Food & Beverage, Agrochemical, Dyes & Pigments, Polymer/Resin, Distillery, Sugar, Other | Yes |
| Application | Dropdown | Concentration, Solvent Recovery, Purification, Stripping, Deodorization, Residue Processing, Other | Yes |
| Requirement | Dropdown | New Equipment, Replacement of Existing, Capacity Upgrade | Yes |

### Section 2: Feed Characteristics (sizing-critical inputs)

| Field | Type | Unit | Required | Notes |
|-------|------|------|----------|-------|
| Feed Material Name | Text | — | Yes | |
| Feed Form | Dropdown: Solution, Slurry | — | Yes | |
| Feed Rate | Number | kg/hr | Yes | |
| Volatile Component | Number | % (w/w) | Yes | Volatile + Non-Volatile should = ~100% |
| Non-Volatile Component | Number | % (w/w) | Yes | |
| Solvent / Volatile Type | Dropdown | See solvent list below | Yes | Auto-populates properties |
| Boiling Point of Volatile | Number | °C | Auto-filled from solvent + pressure | Engineer can override |
| Feed Temperature | Number | °C | No | |
| Feed Viscosity at Operating Temp | Number | cP | No | Used for U classification |
| Feed Viscosity at 25°C | Number | cP | No | |
| Fouling Tendency | Dropdown: None, Low, Moderate, High, Unknown | — | No | |
| Foaming Tendency | Dropdown: None, Low, Moderate, High | — | No | |
| Heat Sensitivity | Dropdown: Not Sensitive, Moderately Sensitive, Highly Sensitive | — | Yes | |
| Max Allowable Product Temp | Number | °C | Yes | |
| Corrosive Nature | Dropdown: Non-Corrosive, Mildly Corrosive, Highly Corrosive | — | No | |

### Section 3: Product Requirements

| Field | Type | Unit | Required |
|-------|------|------|----------|
| Concentrate Flow Rate (Expected) | Number | kg/hr | No (calculated if not given) |
| Target Concentrate Purity | Number | % | No |
| Concentrate Viscosity (Expected) | Number | cP | No |
| Distillate/Vapor Flow Rate | Number | kg/hr | No (calculated if not given) |
| Distillate Purity Required | Number | % | No |

### Section 4: Operating Conditions

| Field | Type | Unit | Required |
|-------|------|------|----------|
| Operating Pressure | Number | (with unit toggle) | Yes |
| Pressure Unit | Dropdown: mbar(a), Torr, mmHg(a), kg/cm²G, Atmospheric | — | Yes |
| Heating Medium | Dropdown: Steam, Hot Water, Hot Oil | — | Yes |
| Steam Pressure (if steam) | Number | bar(g) | Conditional |
| Hot Water / Hot Oil Temperature | Number | °C | Conditional |
| Operating Hours per Day | Number | hours | No |
| Operating Days per Year | Number | days | No |

### Section 5: Utilities Available

| Field | Type | Unit |
|-------|------|------|
| Electrical Supply | Text (e.g. "415V/3Ph/50Hz") | — |
| Steam Pressure | Number | bar(g) |
| Hot Water Temperature | Number | °C |
| Hot Oil Temperature | Number | °C |
| Cooling Water Temperature | Number | °C |
| Chilled Water Temperature | Number | °C |
| Brine Temperature | Number | °C |
| Hazardous Area Classification | Dropdown: Flame proof, Non flame proof | — |

### Section 6: Materials of Construction

| Field | Type | Options |
|-------|------|---------|
| Contact Parts (Wetted) | Dropdown | SS304, SS304L, SS316, SS316L, SS316Ti, Duplex2205, Duplex2507, Hastelloy C22, Hastelloy C276, Titanium, Inconel |
| Non-Contact Parts | Dropdown | MS, SS304, SS316, CS |
| Surface Finish | Dropdown | SS-Acid cleaning and passivation, MS/CS-2 coats of red oxide, Mirror finish/Matte finish |
| Gasket Material | Dropdown | PTFE, Viton, FFKM, Graphite, Asbestos free |

### Section 7: Scope of Supply

Each item is a dropdown: "Yes - Include", "Already Available", or "Not Required" / "Customer Scope"

Items: Condenser, Powder Receiver, Distillate Receiver, Vacuum System, Feed System/Pump, Dry Product Discharge System (Gravity/Screw Conveyor/Pneumatic), Dust Collection/Bag Filter, Scrubber, Interconnecting Piping & Valves, Structural/Platform, Instrumentation (Basic/With Transmitters/Full Automation), Electrical & Cabling, Insulation, Control Panel (Local Panel/PLC Based/PLC + SCADA)

---

## Solvent Property Database

The dropdown for "Solvent / Volatile Type" contains these 21 solvents plus a "Custom / Other" option where the engineer enters properties manually.

For each solvent, store properties at MULTIPLE TEMPERATURES. This is critical — using only 25°C values produces wrong results when operating temperatures differ significantly (which they always do under vacuum). The boiling point at different pressures is calculated via the Antoine equation: log10(P_mmHg) = A - B/(C + T_°C).

### Property Interpolation Logic (MANDATORY — lib/data/solvents.ts)

```typescript
// ALL property lookups MUST use this interpolation function.
// NEVER use a single-temperature value directly in calculations.
// For temperatures outside the data range, extrapolate linearly from the two nearest points
// but flag a warning: "Property extrapolated beyond data range — verify manually."

function getPropertyAtTemp(
  solvent: string, 
  property: 'density' | 'viscosity' | 'Cp' | 'k', 
  T_celsius: number
): number {
  const data = SOLVENT_DB[solvent][property]; // array of {T, value} pairs
  // Linear interpolation between the two nearest data points
  // If T < lowest data point or T > highest data point, extrapolate + warn
}

// For latent heat at operating pressure (not just at Tb_1atm):
// Use Watson correlation: λ₂ = λ₁ × ((Tc - T₂) / (Tc - T₁))^0.38
// where Tc = critical temperature, T₁ = normal Tb, T₂ = actual Tb at operating pressure
// This correction matters: toluene λ at 52°C (vacuum) differs from λ at 110.6°C (1 atm) by ~12%
```

### Solvent Data (lib/data/solvents.ts)

All solvents MUST have data at a minimum of 3 temperature points for density (ρ), viscosity (μ), and thermal conductivity (k). Cp variation is small for most solvents so 2 points is acceptable.

```
Water:
  M: 18.015 g/mol
  Tb_1atm: 100.0 °C
  Tc: 647.1 °C (critical temperature, for Watson correlation)
  Antoine: A=8.07131, B=1730.63, C=233.426 (valid 1-100°C)
  λ_at_Tb: 2257 kJ/kg
  ρ: [{T:25, v:997}, {T:50, v:988}, {T:75, v:975}, {T:100, v:958}] kg/m³
  μ: [{T:25, v:0.89}, {T:50, v:0.55}, {T:75, v:0.38}, {T:100, v:0.28}] cP
  Cp: [{T:25, v:4.18}, {T:75, v:4.19}] kJ/kg·K
  k: [{T:25, v:0.607}, {T:50, v:0.644}, {T:75, v:0.668}, {T:100, v:0.679}] W/m·K

Methanol:
  M: 32.04
  Tb_1atm: 64.7 °C
  Tc: 512.6 °C
  Antoine: A=8.08097, B=1582.27, C=239.726
  λ_at_Tb: 1100 kJ/kg
  ρ: [{T:25, v:787}, {T:40, v:774}, {T:60, v:754}] kg/m³
  μ: [{T:25, v:0.54}, {T:40, v:0.45}, {T:60, v:0.35}] cP
  Cp: [{T:25, v:2.53}, {T:60, v:2.64}] kJ/kg·K
  k: [{T:25, v:0.200}, {T:40, v:0.195}, {T:60, v:0.188}] W/m·K

Ethanol:
  M: 46.07
  Tb_1atm: 78.4 °C
  Tc: 513.9 °C
  Antoine: A=8.32109, B=1718.10, C=237.52
  λ_at_Tb: 846 kJ/kg
  ρ: [{T:25, v:789}, {T:50, v:772}, {T:75, v:750}] kg/m³
  μ: [{T:25, v:1.07}, {T:50, v:0.70}, {T:75, v:0.48}] cP
  Cp: [{T:25, v:2.44}, {T:75, v:2.84}] kJ/kg·K
  k: [{T:25, v:0.171}, {T:50, v:0.164}, {T:75, v:0.156}] W/m·K

Acetone:
  M: 58.08
  Tb_1atm: 56.3 °C
  Tc: 508.1 °C
  Antoine: A=7.11714, B=1210.60, C=229.66
  λ_at_Tb: 539 kJ/kg
  ρ: [{T:20, v:790}, {T:25, v:784}, {T:50, v:756}] kg/m³
  μ: [{T:20, v:0.32}, {T:25, v:0.31}, {T:50, v:0.25}] cP
  Cp: [{T:25, v:2.17}, {T:50, v:2.23}] kJ/kg·K
  k: [{T:25, v:0.161}, {T:40, v:0.155}, {T:55, v:0.148}] W/m·K

IPA (Isopropanol):
  M: 60.10
  Tb_1atm: 82.6 °C
  Tc: 508.3 °C
  Antoine: A=8.11778, B=1580.92, C=219.61
  λ_at_Tb: 758 kJ/kg
  ρ: [{T:25, v:786}, {T:50, v:764}, {T:80, v:733}] kg/m³
  μ: [{T:25, v:2.04}, {T:50, v:1.09}, {T:80, v:0.59}] cP
  Cp: [{T:25, v:2.60}, {T:75, v:3.06}] kJ/kg·K
  k: [{T:25, v:0.135}, {T:50, v:0.132}, {T:80, v:0.127}] W/m·K

Toluene:
  M: 92.14
  Tb_1atm: 110.6 °C
  Tc: 591.8 °C
  Antoine: A=6.95334, B=1343.94, C=219.38
  λ_at_Tb: 363 kJ/kg
  ρ: [{T:25, v:867}, {T:50, v:845}, {T:75, v:823}, {T:110, v:790}] kg/m³
  μ: [{T:25, v:0.56}, {T:50, v:0.42}, {T:75, v:0.33}, {T:110, v:0.24}] cP
  Cp: [{T:25, v:1.69}, {T:75, v:1.85}] kJ/kg·K
  k: [{T:25, v:0.131}, {T:50, v:0.126}, {T:75, v:0.121}, {T:110, v:0.114}] W/m·K

THF (Tetrahydrofuran):
  M: 72.11
  Tb_1atm: 66.0 °C
  Tc: 540.1 °C
  Antoine: A=6.99515, B=1202.29, C=226.25
  λ_at_Tb: 410 kJ/kg
  ρ: [{T:25, v:889}, {T:40, v:871}, {T:60, v:845}] kg/m³
  μ: [{T:25, v:0.46}, {T:40, v:0.39}, {T:60, v:0.32}] cP
  Cp: [{T:25, v:1.72}, {T:60, v:1.83}] kJ/kg·K
  k: [{T:25, v:0.120}, {T:40, v:0.116}, {T:60, v:0.111}] W/m·K

N-Butanol:
  M: 74.12
  Tb_1atm: 117.7 °C
  Tc: 563.0 °C
  Antoine: A=7.36366, B=1305.20, C=173.43
  λ_at_Tb: 591 kJ/kg
  ρ: [{T:25, v:810}, {T:50, v:793}, {T:75, v:775}, {T:115, v:740}] kg/m³
  μ: [{T:25, v:2.57}, {T:50, v:1.39}, {T:75, v:0.83}, {T:115, v:0.44}] cP
  Cp: [{T:25, v:2.39}, {T:75, v:2.63}] kJ/kg·K
  k: [{T:25, v:0.153}, {T:50, v:0.149}, {T:75, v:0.145}, {T:115, v:0.138}] W/m·K

Chloroform:
  M: 119.38
  Tb_1atm: 61.2 °C
  Tc: 536.4 °C
  Antoine: A=6.95465, B=1170.97, C=226.23
  λ_at_Tb: 247 kJ/kg
  ρ: [{T:25, v:1489}, {T:40, v:1460}, {T:60, v:1418}] kg/m³
  μ: [{T:25, v:0.54}, {T:40, v:0.46}, {T:60, v:0.38}] cP
  Cp: [{T:25, v:0.96}, {T:60, v:1.00}] kJ/kg·K
  k: [{T:25, v:0.117}, {T:40, v:0.113}, {T:60, v:0.108}] W/m·K

DMA (Dimethylacetamide):
  M: 87.12
  Tb_1atm: 165.0 °C
  Tc: 658.0 °C
  Antoine: A=7.39, B=1668.0, C=215.0
  λ_at_Tb: 477 kJ/kg
  ρ: [{T:25, v:937}, {T:50, v:916}, {T:100, v:874}] kg/m³
  μ: [{T:25, v:0.92}, {T:50, v:0.66}, {T:100, v:0.39}] cP
  Cp: [{T:25, v:2.01}, {T:100, v:2.18}] kJ/kg·K
  k: [{T:25, v:0.166}, {T:50, v:0.161}, {T:100, v:0.151}] W/m·K

DMF (Dimethylformamide):
  M: 73.09
  Tb_1atm: 153.0 °C
  Tc: 649.6 °C
  Antoine: A=6.93, B=1400.87, C=196.43
  λ_at_Tb: 519 kJ/kg
  ρ: [{T:25, v:944}, {T:50, v:924}, {T:100, v:882}] kg/m³
  μ: [{T:25, v:0.80}, {T:50, v:0.58}, {T:100, v:0.35}] cP
  Cp: [{T:25, v:2.10}, {T:100, v:2.26}] kJ/kg·K
  k: [{T:25, v:0.184}, {T:50, v:0.179}, {T:100, v:0.169}] W/m·K

Ethyl Acetate:
  M: 88.11
  Tb_1atm: 77.1 °C
  Tc: 523.3 °C
  Antoine: A=7.10179, B=1244.95, C=217.88
  λ_at_Tb: 365 kJ/kg
  ρ: [{T:25, v:894}, {T:50, v:866}, {T:75, v:837}] kg/m³
  μ: [{T:25, v:0.43}, {T:50, v:0.33}, {T:75, v:0.26}] cP
  Cp: [{T:25, v:1.93}, {T:75, v:2.12}] kJ/kg·K
  k: [{T:25, v:0.144}, {T:50, v:0.137}, {T:75, v:0.130}] W/m·K

Hexane:
  M: 86.18
  Tb_1atm: 69.0 °C
  Tc: 507.6 °C
  Antoine: A=6.87601, B=1171.17, C=224.41
  λ_at_Tb: 335 kJ/kg
  ρ: [{T:25, v:655}, {T:40, v:641}, {T:65, v:614}] kg/m³
  μ: [{T:25, v:0.30}, {T:40, v:0.26}, {T:65, v:0.21}] cP
  Cp: [{T:25, v:2.27}, {T:65, v:2.42}] kJ/kg·K
  k: [{T:25, v:0.120}, {T:40, v:0.116}, {T:65, v:0.110}] W/m·K

Heptane:
  M: 100.20
  Tb_1atm: 98.4 °C
  Tc: 540.2 °C
  Antoine: A=6.89386, B=1264.37, C=216.64
  λ_at_Tb: 318 kJ/kg
  ρ: [{T:25, v:684}, {T:50, v:664}, {T:75, v:643}, {T:98, v:618}] kg/m³
  μ: [{T:25, v:0.39}, {T:50, v:0.31}, {T:75, v:0.25}, {T:98, v:0.20}] cP
  Cp: [{T:25, v:2.25}, {T:75, v:2.44}] kJ/kg·K
  k: [{T:25, v:0.124}, {T:50, v:0.119}, {T:75, v:0.114}, {T:98, v:0.109}] W/m·K

MIBK (Methyl Isobutyl Ketone):
  M: 100.16
  Tb_1atm: 116.5 °C
  Tc: 574.6 °C
  Antoine: A=6.67272, B=1168.41, C=191.94
  λ_at_Tb: 366 kJ/kg
  ρ: [{T:25, v:798}, {T:50, v:778}, {T:100, v:734}] kg/m³
  μ: [{T:25, v:0.54}, {T:50, v:0.40}, {T:100, v:0.25}] cP
  Cp: [{T:25, v:2.14}, {T:100, v:2.34}] kJ/kg·K
  k: [{T:25, v:0.136}, {T:50, v:0.131}, {T:100, v:0.122}] W/m·K

Nitrobenzene:
  M: 123.11
  Tb_1atm: 210.9 °C
  Tc: 719.0 °C
  Antoine: A=7.11, B=1746.6, C=201.8
  λ_at_Tb: 331 kJ/kg
  ρ: [{T:25, v:1199}, {T:50, v:1178}, {T:100, v:1133}] kg/m³
  μ: [{T:25, v:1.63}, {T:50, v:1.10}, {T:100, v:0.58}] cP
  Cp: [{T:25, v:1.47}, {T:100, v:1.62}] kJ/kg·K
  k: [{T:25, v:0.149}, {T:50, v:0.146}, {T:100, v:0.140}] W/m·K

Pyridine:
  M: 79.10
  Tb_1atm: 115.2 °C
  Tc: 620.0 °C
  Antoine: A=6.97, B=1373.8, C=214.98
  λ_at_Tb: 456 kJ/kg
  ρ: [{T:25, v:978}, {T:50, v:956}, {T:100, v:911}] kg/m³
  μ: [{T:25, v:0.88}, {T:50, v:0.62}, {T:100, v:0.36}] cP
  Cp: [{T:25, v:1.68}, {T:100, v:1.87}] kJ/kg·K
  k: [{T:25, v:0.166}, {T:50, v:0.161}, {T:100, v:0.151}] W/m·K

Aniline:
  M: 93.13
  Tb_1atm: 184.1 °C
  Tc: 699.0 °C
  Antoine: A=7.32, B=1731.5, C=206.05
  λ_at_Tb: 426 kJ/kg
  ρ: [{T:25, v:1022}, {T:50, v:1003}, {T:100, v:964}] kg/m³
  μ: [{T:25, v:3.71}, {T:50, v:2.03}, {T:100, v:0.82}] cP
  Cp: [{T:25, v:2.18}, {T:100, v:2.41}] kJ/kg·K
  k: [{T:25, v:0.172}, {T:50, v:0.170}, {T:100, v:0.165}] W/m·K

Methylene Dichloride (DCM):
  M: 84.93
  Tb_1atm: 39.6 °C
  Tc: 510.0 °C
  Antoine: A=7.08, B=1138.9, C=231.45
  λ_at_Tb: 330 kJ/kg
  ρ: [{T:20, v:1327}, {T:25, v:1325}, {T:35, v:1300}] kg/m³
  μ: [{T:20, v:0.43}, {T:25, v:0.41}, {T:35, v:0.36}] cP
  Cp: [{T:25, v:1.19}, {T:35, v:1.22}] kJ/kg·K
  k: [{T:20, v:0.142}, {T:25, v:0.140}, {T:35, v:0.136}] W/m·K

Acetic Acid:
  M: 60.05
  Tb_1atm: 118.1 °C
  Tc: 591.5 °C
  Antoine: A=7.38782, B=1533.31, C=222.31
  λ_at_Tb: 395 kJ/kg
  ρ: [{T:25, v:1049}, {T:50, v:1027}, {T:100, v:976}] kg/m³
  μ: [{T:25, v:1.13}, {T:50, v:0.79}, {T:100, v:0.43}] cP
  Cp: [{T:25, v:2.05}, {T:100, v:2.26}] kJ/kg·K
  k: [{T:25, v:0.158}, {T:50, v:0.155}, {T:100, v:0.148}] W/m·K

Xylene (mixed):
  M: 106.16
  Tb_1atm: 139.0 °C
  Tc: 616.2 °C
  Antoine: A=6.99052, B=1453.43, C=215.31
  λ_at_Tb: 340 kJ/kg
  ρ: [{T:25, v:860}, {T:50, v:840}, {T:100, v:795}, {T:139, v:760}] kg/m³
  μ: [{T:25, v:0.60}, {T:50, v:0.45}, {T:100, v:0.28}, {T:139, v:0.20}] cP
  Cp: [{T:25, v:1.72}, {T:100, v:1.92}] kJ/kg·K
  k: [{T:25, v:0.130}, {T:50, v:0.126}, {T:100, v:0.118}, {T:139, v:0.112}] W/m·K
```

When engineer selects "Custom / Other", all property fields become manual input and required. The form must ask for properties at a minimum of 2 temperature points (25°C and operating temperature) for density, viscosity, and thermal conductivity.

---

## Saturated Steam Table

Store saturated steam properties indexed by pressure. This is used to determine heating medium temperature from steam pressure.

```
STEAM TABLE (lib/data/steam.ts):

Pressure bar(g) → T_sat (°C), λ (kJ/kg)
0.0  → 100.0, 2257
0.5  → 111.4, 2227
1.0  → 120.2, 2202
1.5  → 127.4, 2181
2.0  → 133.5, 2163
2.5  → 138.9, 2147
3.0  → 143.6, 2133
3.5  → 147.9, 2120
4.0  → 151.8, 2108
4.5  → 155.5, 2097
5.0  → 158.8, 2086
6.0  → 164.9, 2067
7.0  → 170.4, 2048
8.0  → 175.4, 2031
9.0  → 179.9, 2015
10.0 → 184.1, 2000
12.0 → 191.6, 1972
14.0 → 198.3, 1946
16.0 → 204.3, 1921

Interpolate linearly between points.
```

---

## NaCl BPE Correlation (lib/data/bpe-correlations.ts)

BPE (Boiling Point Elevation) auto-calculation for NaCl/brine systems. This is mandatory — manually entering BPE = 0 for concentrated brine systems is the #1 sizing error.

```
// BPE for NaCl solutions (°C) as a function of concentration (wt% NaCl) and temperature (°C)
// Source: standard thermodynamic tables
// Valid range: 0–26 wt% NaCl (saturation), 40–180°C

BPE_DATA (lib/data/bpe-correlations.ts):

// Polynomial fit: BPE(°C) = a₁·w + a₂·w² + a₃·w³
// where w = weight fraction NaCl (0 to 0.26)
// Coefficients vary slightly with temperature; use T-dependent fit:

// At ~100°C (atmospheric):
//   BPE = 0.0 (0%), 0.6 (5%), 1.5 (10%), 3.0 (15%), 5.3 (20%), 8.5 (25%)
// At ~60°C (moderate vacuum):  
//   BPE = 0.0 (0%), 0.5 (5%), 1.3 (10%), 2.7 (15%), 4.8 (20%), 7.8 (25%)

// Simplified correlation (good to ±0.3°C for engineering estimates):
// BPE = 104.9 × w² + 13.2 × w    (at 100°C reference)
// Temperature correction factor: multiply by (0.85 + 0.0015 × T_boil_°C)

// Implementation:
function calculateBPE_NaCl(concentration_wt_pct: number, T_boil: number): number {
  const w = concentration_wt_pct / 100;  // convert to fraction
  const BPE_100 = 104.9 * w * w + 13.2 * w;  // °C at 100°C reference
  const T_correction = 0.85 + 0.0015 * T_boil;
  return BPE_100 * T_correction;
}
```

### BPE Integration in the Form

Add a sub-section under "Operating Conditions" (Section 4):

| Field | Type | Options | Shown When |
|-------|------|---------|------------|
| BPE Source | Dropdown | Manual Entry, NaCl Auto-Calculate, Not Applicable | Always |
| NaCl Concentration | Number (wt%) | — | BPE Source = "NaCl Auto-Calculate" |
| BPE (manual) | Number (°C) | — | BPE Source = "Manual Entry" |

- If "NaCl Auto-Calculate": compute BPE from concentration and boiling point, display the calculated value, allow override
- If "Manual Entry": engineer enters BPE directly
- If "Not Applicable": BPE = 0 (pure solvent system — only valid if Non-Volatile % < 5%)
- **VALIDATION**: If Non-Volatile % > 10% AND BPE Source = "Not Applicable", show warning: "Feed contains significant dissolved solids — BPE is likely non-zero. Please enter BPE or select NaCl auto-calculate."

---

## ATFE U-Value Ranges (for Preliminary Mode + Sanity Checks)

```
U-VALUE LOOKUP (lib/data/u-ranges.ts):

ATFE U-values by feed viscosity (W/m²·K):
  < 10 cP    (water-like):       U = 2000–3000, default 2500
  10–50 cP   (light organics):   U = 1500–2500, default 2000
  50–200 cP  (moderate):         U = 1000–2000, default 1500
  200–500 cP (viscous):          U = 800–1500,  default 1000
  500–2000 cP (highly viscous):  U = 500–1000,  default 700
  > 2000 cP  (extremely viscous): U = 300–700,  default 500

CRITICAL: The viscosity that matters is the FEED viscosity at operating temperature,
NOT the pure solvent viscosity. A 40% solids-in-toluene slurry might be 200 cP even 
though pure toluene is 0.56 cP. The lookup priority is:

1. If "Feed Viscosity at Operating Temp" is entered → use that (ALWAYS overrides)
2. If "Feed Viscosity at 25°C" is entered → use that as a rough proxy
3. If neither is entered → use the pure solvent viscosity proxy below AS A LAST RESORT,
   and show warning: "Using pure solvent viscosity as proxy — actual feed viscosity 
   with dissolved solids will be higher. Enter measured viscosity for accurate sizing."

Pure solvent viscosity proxy (LAST RESORT only):
  Water, Methanol, Acetone, DCM, Hexane, Chloroform → "< 10 cP" range
  Ethanol, IPA, Toluene, THF, Ethyl Acetate, MIBK   → "10–50 cP" range
  DMF, DMA, Pyridine, Acetic Acid                    → "10–50 cP" range
  Aniline, N-Butanol, Nitrobenzene                    → "50–200 cP" range
```

---

## Calculation Engine: ATFE (lib/engines/atfe.ts)

### Input Processing

1. Parse operating pressure to mbar(a):
   - If "Atmospheric" → 1013.25 mbar
   - If mbar(a) → use directly
   - If Torr → multiply by 1.33322
   - If mmHg(a) → multiply by 1.33322
   - If kg/cm²G → (value × 980.665) + 1013.25 to get mbar(a)

2. Calculate boiling point of volatile at operating pressure:
   - Use Antoine equation: T_boil = B / (A - log10(P_mmHg)) - C
   - where P_mmHg = P_mbar × 0.750062

3. Determine heating medium temperature:
   - If Steam: T_heating = T_sat from steam table at entered bar(g)
   - If Hot Water: T_heating = entered temperature
   - If Hot Oil: T_heating = entered temperature

### Mass Balance

```
ṁ_feed = Feed Rate (kg/hr)
ṁ_evap = ṁ_feed × (Volatile % / 100)
ṁ_concentrate = ṁ_feed - ṁ_evap

// Cross-check: if engineer entered Concentrate Flow Rate, verify:
// |ṁ_concentrate_calc - ṁ_concentrate_entered| / ṁ_concentrate_entered < 0.05
// If mismatch > 5%, show warning
```

### Heat Duty

```
// LATENT HEAT — must be corrected for operating pressure using Watson correlation
// DO NOT just use λ_at_Tb (normal boiling point) for all pressures.
// The error can be 10-15% for organics at deep vacuum.

T_boil_actual_pure = Antoine boiling point at operating pressure (from Step 2 above)
T_boil_normal = solvent.Tb_1atm
Tc = solvent.Tc  // critical temperature (°C), stored in solvent database
λ_normal = solvent.lambda_at_Tb  // kJ/kg at normal boiling point

// Watson correlation for latent heat at different temperatures:
// λ₂ = λ₁ × ((Tc - T₂) / (Tc - T₁))^0.38
λ_operating = λ_normal × Math.pow(
  (Tc - T_boil_actual_pure) / (Tc - T_boil_normal), 
  0.38
)  // kJ/kg

// SENSIBLE HEAT — Cp_feed depends on whether this is pure solvent or solution
// This is NOT just the pure solvent Cp.

// Cp_feed determination (priority order):
// 1. If engineer enters "Feed Specific Heat" (optional field in Section 2) → use that
// 2. If not entered, estimate from composition:
//    Cp_feed = (volatile_fraction × Cp_solvent) + (nonvolatile_fraction × Cp_solids)
//    where Cp_solids ≈ 1.0 kJ/kg·K (typical for organic solids) or 0.84 (inorganic salts)
//    Use 1.0 as default for Cp_solids unless engineer overrides
// 3. Cp_solvent must be looked up at T_mean = (T_feed + T_boil) / 2 using interpolation

volatile_frac = Volatile_pct / 100
nonvolatile_frac = 1 - volatile_frac
T_mean_sensible = (T_feed + T_boil_actual_pure) / 2

Cp_solvent = getPropertyAtTemp(solvent, 'Cp', T_mean_sensible)  // kJ/kg·K
Cp_solids = 1.0  // default, overridable
Cp_feed = volatile_frac × Cp_solvent + nonvolatile_frac × Cp_solids

Q_sensible = ṁ_feed × Cp_feed × (T_boil_actual - T_feed) / 3600  (kW)
// where T_boil_actual = T_boil_actual_pure + BPE
// If feed temp not entered, assume feed enters at boiling point → Q_sensible = 0

// LATENT HEAT for evaporation — uses pressure-corrected λ
Q_latent = ṁ_evap × λ_operating / 3600  (kW)

// Total heat duty
Q_total = Q_sensible + Q_latent  (kW)
```

**Add to Section 2 (Feed Characteristics) form — new optional field:**

| Field | Type | Unit | Required | Notes |
|-------|------|------|----------|-------|
| Feed Specific Heat (Cp) | Number | kJ/kg·K | No | If blank, estimated from composition. Override for known mixtures. |

### Temperature Driving Force

```
// BPE: determined from the BPE Source selection in Section 4:
// - "NaCl Auto-Calculate" → BPE = calculateBPE_NaCl(concentration, T_boil_pure)
// - "Manual Entry" → BPE = entered value
// - "Not Applicable" → BPE = 0 (but warn if Non-Volatile % > 10%)

T_boil_actual = T_boil_pure + BPE

// Effective temperature difference
ΔT_eff = T_heating - T_boil_actual

// VALIDATION:
// If ΔT_eff < 5°C → ERROR: "Insufficient temperature driving force. 
//   Increase heating medium temperature or reduce operating pressure."
// If ΔT_eff < 10°C → WARNING: "Low ΔT. Area will be large and sensitive 
//   to small changes in operating conditions."
// If ΔT_eff > 80°C → WARNING: "Very high ΔT. Consider thermal degradation 
//   risk. Check max allowable product temperature."

// Check: T_heating must not exceed Max Allowable Product Temp
// If T_wall ≈ T_heating > Max Product Temp → ERROR
```

### PRELIMINARY MODE — Area Calculation

```
// Select U from lookup table based on viscosity
U_prelim = getUFromViscosity(feed_viscosity_cP)  // W/m²·K

// Simple area calculation (no LMTD — use ΔT_eff directly since 
// ATFE is essentially isothermal evaporation, not counter-current)
A_required = (Q_total × 1000) / (U_prelim × ΔT_eff)  // m²
// Note: Q_total is in kW, multiply by 1000 for W

// Standard ATFE sizes (EcoProcess range):
// 0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 6.0, 8.0, 10.0, 12.0, 15.0, 20.0 m²
// Select the smallest standard size ≥ A_required
A_selected = selectStandardSize(A_required)

// Overdesign
overdesign_pct = ((A_selected - A_required) / A_required) × 100
```

### DETAILED MODE — Area Calculation

```
// ATFE inner heat transfer coefficient from penetration theory:
// h_inner = 2 × sqrt(k_fluid × ρ × Cp / (π × t_contact))
// where t_contact = blade_clearance / (π × D_rotor × N_rpm/60)

// Typical ATFE parameters (can be made adjustable in advanced settings):
D_rotor = sqrt(A_required / (π × L_D_ratio))  // approximate from area
// L/D ratio for ATFE is typically 5-10, default 7
blade_clearance = 0.001  // m (1mm typical)
N_rpm = 300  // typical rotor speed, RPM

t_contact = blade_clearance / (π × D_rotor × N_rpm / 60)  // seconds

// Fluid properties at mean temperature T_mean = (T_feed + T_boil_actual) / 2
// IMPORTANT: For solutions with dissolved solids, use SOLUTION properties, not pure solvent.
// For k and ρ, pure solvent values are acceptable approximation for dilute solutions (< 20% solids).
// For Cp, ALWAYS use the mixture Cp: Cp_feed = volatile_frac × Cp_solvent + nonvolatile_frac × Cp_solids
k_fluid = getPropertyAtTemp(solvent, 'k', T_mean)  // W/m·K — interpolated at T_mean
ρ_fluid = getPropertyAtTemp(solvent, 'density', T_mean)  // kg/m³ — interpolated at T_mean
Cp_fluid = Cp_feed × 1000  // J/kg·K (use the SAME Cp_feed calculated in Heat Duty section)

h_inner = 2 × sqrt(k_fluid × ρ_fluid × Cp_fluid / (π × t_contact))

// Outer (heating medium) coefficient:
// Steam condensing: h_outer = 8000-12000 W/m²·K (use 10000 default)
// Hot water: h_outer = 2000-5000 W/m²·K (use 3000 default)
// Hot oil: h_outer = 500-1500 W/m²·K (use 1000 default)
h_outer = getHeatingMediumCoeff(heating_medium)

// Wall resistance
t_wall = 0.004  // m (4mm typical wall)
k_wall = 16  // W/m·K for SS316 (default)

// Fouling resistance (from fouling tendency selection)
R_fouling_inner = getFoulingFactor(fouling_tendency)
// None: 0.0001, Low: 0.0002, Moderate: 0.0003, High: 0.0005, Unknown: 0.0003

R_fouling_outer = 0.0001  // Steam/hot fluid side (typically clean)

// Overall U:
1/U_calc = (1/h_inner) + R_fouling_inner + (t_wall/k_wall) + R_fouling_outer + (1/h_outer)
U_calc = 1 / (1/h_inner + R_fouling_inner + t_wall/k_wall + R_fouling_outer + 1/h_outer)

// Area
A_required = (Q_total × 1000) / (U_calc × ΔT_eff)  // m²
A_selected = selectStandardSize(A_required)
overdesign_pct = ((A_selected - A_required) / A_required) × 100

// SANITY CHECK: Compare U_calc to lookup range
U_range = getURangeForViscosity(feed_viscosity_cP)
if (U_calc < U_range.min × 0.7 || U_calc > U_range.max × 1.3) {
  warning: "Calculated U-value outside expected range. Review input properties."
}
```

### Additional Outputs (both modes)

```
// Steam consumption (if heating medium is steam)
steam_consumption = Q_total / (λ_steam / 3600)  // kg/hr
// where λ_steam is from steam table at the entered pressure

// Condenser duty (equal to Q_latent — the vapor needs to be condensed)
Q_condenser = Q_latent  // kW

// Cooling water flow for condenser
// Assume CW rises from CW_in to CW_in + 10°C (standard 10°C rise)
CW_flow = Q_condenser / (4.18 × 10 / 3600)  // kg/hr

// Vacuum system
// The vacuum pump must handle non-condensable gases + air leakage
// Rule of thumb for preliminary: 5-15 kg/hr air leakage for standard systems
// This is flagged as "to be confirmed by detailed vacuum system design"

// Estimated rotor power (rough estimate)
// P/V correlation: P ≈ 5-15 kW/m² of heated area (depends on viscosity)
// Low viscosity: 5 kW/m², High viscosity: 15 kW/m²
rotor_power = A_selected × getPowerPerArea(feed_viscosity)  // kW
```

### Sensitivity Analysis (show in results)

After calculation, compute how A changes if key inputs vary by ±20%:

```
// Recalculate A with viscosity +20% and -20%
// Recalculate A with ΔT +10°C and -10°C
// Recalculate A with Q +10% (safety factor)
// Show as a small table:
// "If viscosity is 20% higher → A increases by X%"
// "If BPE is 2°C more than estimated → A increases by Y%"
```

---

## Sanity Checks (lib/engines/sanity.ts)

After every calculation, run these checks. Display as ✅ / ⚠️ / 🔴:

```
1. Mass balance closure: ṁ_feed = ṁ_evap + ṁ_concentrate (within 1%)
   → ✅ if OK, 🔴 if not

2. ΔT_eff ≥ 5°C
   → 🔴 if < 5, ⚠️ if < 10, ✅ if ≥ 10

3. T_heating ≤ Max Allowable Product Temp
   → 🔴 if exceeded (thermal degradation risk)

4. U_calc within expected range for viscosity class
   → ✅ if within range, ⚠️ if within 1.5× range, 🔴 if outside 2×

5. BPE accounted for?
   → ⚠️ if BPE = 0 and feed has dissolved solids (check Non-Volatile % > 10%)

6. Overdesign between 10-30%
   → ✅ if 10-30%, ⚠️ if < 10% or > 50%

7. Pilot testing triggers:
   → ⚠️ PILOT RECOMMENDED if:
      - Viscosity > 500 cP
      - Fouling tendency = "High" or "Unknown"
      - Heat sensitivity = "Highly Sensitive"
      - Feed Form = "Slurry"
```

---

## Results Display (components/ResultsPanel.tsx)

Show results in a clean card layout:

**Summary Card:**
- Heat Duty: Q_total kW (breakdown: Q_sensible + Q_latent)
- Required Area: A_required m²
- Selected ATFE Size: A_selected m²
- Overdesign: X%
- Mode: Preliminary / Detailed

**Thermal Design Card:**
- U-value: X W/m²·K (source: "Lookup table" or "Calculated")
- ΔT effective: X °C
- Boiling Point at operating pressure: X °C
- BPE: X °C
- LMTD (corrected): X °C

**Detailed Mode Only — U-value Breakdown Card:**
- h_inner (process side): X W/m²·K
- h_outer (heating medium): X W/m²·K
- R_fouling (inner): X m²·K/W
- R_fouling (outer): X m²·K/W
- R_wall: X m²·K/W
- U_overall: X W/m²·K

**Utilities Card:**
- Steam consumption: X kg/hr (at Y bar(g))
- Condenser duty: X kW
- Cooling water flow: X kg/hr
- Estimated rotor power: X kW

**Sensitivity Card:**
- Table showing area variation with ±20% viscosity, ±5°C BPE, etc.

**Sanity Checks Card:**
- List of all checks with ✅ / ⚠️ / 🔴 indicators

**Pilot Triggers Card (if any):**
- List of triggered flags with explanations

---

## PDF Datasheet

The "Generate Datasheet" button creates a downloadable PDF with:

1. **Header:** ECOPROCESS logo area, document number (auto EP-DS-ATFE-XXX), revision 0, date
2. **General:** Customer info (if entered), project reference, equipment type, service
3. **Process Conditions:** All entered operating parameters
4. **Thermal Design:** All calculated values
5. **Sanity Checks:** All check results
6. **Calculation Basis:** Mode, U-value source, assumptions, software version
7. **Scope of Supply:** Selected items from Section 7

The PDF should be professional but doesn't need to match HTRI format exactly — this is an EcoProcess-specific document.

---

## UI/UX Guidelines

- Clean, professional look. Not flashy — this is an engineering tool.
- EcoProcess brand color: dark green (#1B5E20 or similar) for header and primary actions
- Form is a single scrollable page with collapsible sections
- Results panel appears on the right side (desktop) or below the form (mobile)
- "Calculate" button is prominent, disabled until all required fields are filled
- Mode toggle (Preliminary/Detailed) is visible at the top of the results panel
- Preliminary mode results have a subtle "BUDGETARY ESTIMATE" watermark or banner
- Numbers display with appropriate precision:
  - Area: 1 decimal (e.g., 4.2 m²)
  - U-value: 0 decimals (e.g., 1850 W/m²·K)
  - Temperature: 1 decimal (e.g., 82.3 °C)
  - Heat duty: 1 decimal (e.g., 156.3 kW)
  - Flow rates: 0 decimals (e.g., 450 kg/hr)
- Error messages are inline, near the field that caused them
- Warnings and sanity checks use color coding: green/amber/red

---

## What NOT To Build Yet

- No other equipment types (S&T, FFE, RVPD, etc.) — ATFE only
- No user authentication or login
- No saved calculations or history
- No cost configurator integration
- No multi-effect evaporation
- No database — everything is calculated fresh each time
- BPE: NaCl auto-calculate is included; other salt systems (KCl, CaCl₂, mixed brines) are deferred

---

## Validation Test Cases (MANDATORY)

Claude Code MUST verify the calculation engine produces correct results for ALL THREE test cases below before considering the build complete. These cover water, an organic solvent, and a high-BPE brine system. If any test case fails, the engine has a bug.

### Test Case 1: Water Evaporation (baseline)
```
Inputs:
  Feed Rate: 1000 kg/hr
  Volatile: 80% water
  Non-Volatile: 20% solids
  Solvent: Water
  Operating Pressure: 100 mbar(a)
  Heating Medium: Steam at 3 bar(g) (T_steam = 143.6°C)
  Feed Temperature: 25°C
  BPE: 0 (pure water assumed for this test)
  Feed Viscosity: not entered (use proxy → < 10 cP → U = 2500)

Expected Results (Preliminary Mode):
  T_boil (Antoine at 100 mbar): ≈ 45.8°C
  λ_operating (Watson corrected): ≈ 2392 kJ/kg  
    (Watson: 2257 × ((647.1-45.8)/(647.1-100))^0.38 ≈ 2392)
  ṁ_evap: 800 kg/hr
  Q_sensible: 1000 × 3.55 × (45.8 - 25) / 3600 ≈ 20.5 kW
    (Cp_feed = 0.8×4.18 + 0.2×1.0 = 3.55 kJ/kg·K, at T_mean≈35°C)
  Q_latent: 800 × 2392 / 3600 ≈ 531.6 kW
  Q_total: ≈ 552 kW
  ΔT_eff: 143.6 - 45.8 = 97.8°C
  A_required: 552,000 / (2500 × 97.8) ≈ 2.26 m²
  A_selected: 3.0 m²
  Overdesign: ≈ 33%
```

### Test Case 2: Toluene Evaporation (organic solvent — tests multi-temp properties)
```
Inputs:
  Feed Rate: 500 kg/hr
  Volatile: 90% toluene
  Non-Volatile: 10% solids
  Solvent: Toluene
  Operating Pressure: 100 mbar(a)
  Heating Medium: Steam at 3 bar(g) (T_steam = 143.6°C)
  Feed Temperature: 30°C
  BPE: 0 (dilute solution)
  Feed Viscosity: not entered (proxy → 10-50 cP range → U = 2000)

Expected Results (Preliminary Mode):
  T_boil (Antoine at 100 mbar): 
    P_mmHg = 100 × 0.750062 = 75.0 mmHg
    T = 1343.94 / (6.95334 - log10(75.0)) - 219.38
    log10(75) = 1.875
    T = 1343.94 / (6.95334 - 1.875) - 219.38 = 1343.94/5.078 - 219.38 ≈ 45.3°C
  λ_operating (Watson): 363 × ((591.8-45.3)/(591.8-110.6))^0.38
    = 363 × (546.5/481.2)^0.38 = 363 × 1.047 ≈ 380 kJ/kg
  ṁ_evap: 450 kg/hr
  Cp_feed = 0.9 × 1.69 + 0.1 × 1.0 = 1.621 kJ/kg·K (at ~25°C, close enough for T_mean≈37°C)
  Q_sensible: 500 × 1.621 × (45.3 - 30) / 3600 ≈ 3.4 kW
  Q_latent: 450 × 380 / 3600 ≈ 47.5 kW
  Q_total: ≈ 50.9 kW
  ΔT_eff: 143.6 - 45.3 = 98.3°C
  A_required: 50,900 / (2000 × 98.3) ≈ 0.26 m²
  A_selected: 0.5 m² (smallest standard size)
  Overdesign: ≈ 92% (expected — very small duty)
```

### Test Case 3: NaCl Brine Concentration (tests BPE + high solids)
```
Inputs:
  Feed Rate: 2000 kg/hr
  Volatile: 85% water
  Non-Volatile: 15% (NaCl brine)
  Solvent: Water
  Operating Pressure: 200 mbar(a) 
  Heating Medium: Steam at 5 bar(g) (T_steam = 158.8°C)
  Feed Temperature: 60°C
  BPE Source: NaCl Auto-Calculate
  NaCl Concentration: 15 wt%
  Feed Viscosity: 1.5 cP (entered — brine is slightly more viscous than water)

Expected Results (Preliminary Mode):
  T_boil_pure (Antoine at 200 mbar): ≈ 60.1°C
  BPE = calculateBPE_NaCl(15, 60.1):
    w = 0.15
    BPE_100 = 104.9 × 0.0225 + 13.2 × 0.15 = 2.36 + 1.98 = 4.34°C
    T_correction = 0.85 + 0.0015 × 60.1 = 0.940
    BPE ≈ 4.08°C ≈ 4.1°C
  T_boil_actual = 60.1 + 4.1 = 64.2°C
  λ_operating (Watson for water at 60.1°C): 
    2257 × ((647.1-60.1)/(647.1-100))^0.38 = 2257 × (587/547.1)^0.38 ≈ 2257 × 1.028 ≈ 2320 kJ/kg
  ṁ_evap: 1700 kg/hr
  Cp_feed = 0.85 × 4.18 + 0.15 × 0.84 = 3.68 kJ/kg·K (using 0.84 for NaCl)
  Q_sensible: 2000 × 3.68 × (64.2 - 60) / 3600 ≈ 8.6 kW
  Q_latent: 1700 × 2320 / 3600 ≈ 1095.6 kW
  Q_total: ≈ 1104 kW
  ΔT_eff: 158.8 - 64.2 = 94.6°C
  U_prelim: viscosity 1.5 cP → < 10 cP range → U = 2500
  A_required: 1,104,000 / (2500 × 94.6) ≈ 4.67 m²
  A_selected: 5.0 m²
  Overdesign: ≈ 7% → ⚠️ WARNING (below 10% minimum)

  Sanity checks should flag:
  - ⚠️ Overdesign below 10% — consider next size up (6.0 m²)
  - ✅ BPE accounted for (4.1°C)
  - ✅ Mass balance OK
  - ✅ ΔT_eff = 94.6°C (healthy)
```

### How To Run These Tests

Claude Code should implement these as automated tests (e.g., in `__tests__/engines/atfe.test.ts` or similar). Each test:
1. Creates input objects matching the test case
2. Runs the calculation engine
3. Asserts Q_total within ±5% of expected
4. Asserts A_required within ±10% of expected
5. Asserts all sanity check flags match expected

If a test fails, debug the engine — do NOT adjust the test expectations to match wrong output.

---

# ADDENDUM v2.1 (2026-07-19) — Mixtures, Partial Evaporation, Boiling Point Override

Implemented after field feedback that v2 results were significantly off for real feeds.
Root causes identified and verified (all 19 v2 validation tests still pass unchanged):

## A. Multi-solvent volatile mixtures (lib/engines/mixture.ts)
- v2 modeled the volatile fraction as ONE pure solvent. Real feeds are often mixed
  (e.g. 50/50 wt MeOH-water at 100 mbar: λ error 35% if modeled as pure water).
- Model: ideal-solution (Raoult) bubble point via bisection on Σ xᵢPᵢsat(T) = P using
  the existing Antoine constants; mole fractions from mass fractions via M.
- λ_mixture = Σ wᵢ × λᵢ(Watson-corrected to T_bubble). Cp, k mass-weighted;
  density volume-mixed (1/ρ = Σ wᵢ/ρᵢ). Viscosity proxy (last resort) = max of
  component proxies (conservative).
- KNOWN LIMITATION: ideal model overestimates bubble point ~5–10°C for
  positive-deviation pairs (alcohol–water etc.) and cannot represent azeotropes.
  A lookup of 14 known non-ideal pairs raises explicit warnings directing the
  engineer to the Boiling Point Override. Activity-coefficient models (van Laar/
  NRTL) deferred pending verified binary interaction parameters.
- Warning raised when component normal-Tb spread > 20°C (boiling temperature
  rises as lights strip out; feed-composition bubble point may be optimistic).

## B. Boiling Point Override (spec Section 2 requirement — was never built)
- New optional field: engineer-entered boiling point at operating pressure.
  Takes precedence over Antoine and bubble-point values. Result reports the
  source used: antoine | bubble_point_ideal | override | fallback.

## C. Partial evaporation via Target Concentrate Purity (lib/engines/atfe.ts)
- v2 collected Target Concentrate Purity but never used it; m_evap was ALWAYS
  feed × volatile% (total removal). For concentration duties this oversizes duty
  (20%→50% solids example: +33% duty, one full ATFE size step).
- When Target Concentrate Purity (% solids in concentrate) is entered:
  m_concentrate = (feed × nonvolatile%) / target%, m_evap = feed − m_concentrate.
  Validation: target must exceed feed solids % and not exceed 100%.
- When absent: total volatile removal (v2 behavior preserved); a warning is shown
  if Application = Concentration. Result reports evapBasis.

## Validation added (__tests__/engines/mixture.test.ts, 15 tests)
- Pure-component regression of bubble-point solver vs Antoine Tb (±0.5%).
- 50/50 MeOH-water @100 mbar: T_bubble 28.9°C, λ_mix 1748 kJ/kg, Q_total 440 kW,
  A_required 1.54 m² (hand-computed independently, Python, 2026-07-19).
- Override precedence, vapor enrichment in light component, composition
  normalization, non-ideal pair warnings.
- Partial evap: 20%→50% solids → m_evap 600 kg/hr, Q_total 419 kW, A_selected
  2.0 m² (vs 3.0 total-removal); rejection of invalid targets; regression that
  absent target reproduces spec Test Case 1 exactly.

---

# ADDENDUM v2.2 (2026-07-19) — Engineer Overrides, C&R Reference, Factory Costing

## Sizing additions (questionnaire-driven)
- `distillateLatentHeat` (kJ/kg): questionnaire field; overrides Watson/mixture λ.
- `uValueOverride` (W/m²·K): engineering-owned U; overrides lookup/correlation.
  Result reports U_source: lookup | calculated | override.
- Coulson & Richardson Vol. 6 (3rd Ed., Sinnott) steam-heated vaporiser analogue
  (aqueous 1000–1500, light organics 900–1200 W/m²·K, NON-agitated) is displayed
  beside the selected U; a warning fires when selected U > 2× the analogue max.
  Rationale: C&R is the citable authority available; ATFE agitated-film premium
  must be a visible engineering decision pending back-test calibration.

## Factory costing module (new)
- lib/costing/rates.ts — all rates with per-value provenance from:
  Thermax_ATFE-7_5_M2-costing.xlsx, IDHMA costing, EPSPL_RATES.pdf (FY24-25),
  Rates-OUTSOURCING.xlsx, and the team's costings_questions.xlsx (open items ⚠).
- lib/costing/engine.ts — weight-buildup model per the Thermax cell formulas
  (verbatim formula list in rates.ts). Validation: __tests__/costing reproduces
  the Thermax grand total ₹17,63,997 ±1%, plus component weights and overheads.
- Margin is a separate layer on factory cost (per the 'Final Cost - MNS SIR'
  management-adjustment pattern) — never hidden inside factory cost.

## Open items requiring engineering decisions (from costings_questions.xlsx)
Fixed-cost % rule (3–20% observed), hardware 5% vs 10%, consumables ₹15 vs ₹20/kg,
BF machining lump-sum vs ₹/mm/dia formula semantics, SHE 60% weight rule,
limpet ₹1,200/RMT scope, tube-rate outliers (Johnson ₹2,100).
