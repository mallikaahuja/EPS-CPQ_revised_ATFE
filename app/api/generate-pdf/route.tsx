import { NextRequest, NextResponse } from 'next/server';
import React from 'react';
import { renderToBuffer, Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import type { ATFEInputs, ATFEResults } from '@/lib/types';

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 9, color: '#1a1a1a', fontFamily: 'Helvetica' },
  header: { backgroundColor: '#1B5E20', padding: 12, marginBottom: 16 },
  headerTitle: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: 'white', marginBottom: 2 },
  headerSub: { fontSize: 8, color: '#a5d6a7' },
  section: { marginBottom: 10 },
  sectionTitle: {
    fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#1B5E20',
    borderBottomWidth: 1, borderBottomColor: '#1B5E20',
    paddingBottom: 2, marginBottom: 5,
  },
  row: {
    flexDirection: 'row' as const, justifyContent: 'space-between' as const,
    paddingVertical: 2, borderBottomWidth: 0.5, borderBottomColor: '#eeeeee',
  },
  label: { color: '#555555', flex: 2 },
  value: { fontFamily: 'Helvetica-Bold', flex: 1, textAlign: 'right' as const },
  checkRow: { flexDirection: 'row' as const, gap: 4, paddingVertical: 1.5 },
  twoCol: { flexDirection: 'row' as const, gap: 14 },
  col: { flex: 1 },
  footer: {
    position: 'absolute' as const, bottom: 20, left: 40, right: 40,
    borderTopWidth: 0.5, borderTopColor: '#cccccc', paddingTop: 4,
    flexDirection: 'row' as const, justifyContent: 'space-between' as const,
  },
  footerText: { fontSize: 7, color: '#888888' },
  badge: { backgroundColor: '#fff3e0', padding: '3 6', marginBottom: 8, alignSelf: 'flex-start' as const },
  badgeText: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#e65100' },
});

const el = React.createElement;

function DocRow({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return el(View, { style: styles.row },
    el(Text, { style: styles.label }, label),
    el(Text, { style: styles.value }, value + (unit ? ` ${unit}` : '')),
  );
}

function Sec({ title, children }: { title: string; children?: React.ReactNode }) {
  return el(View, { style: styles.section },
    el(Text, { style: styles.sectionTitle }, title),
    children,
  );
}

function checkIcon(status: string): string {
  if (status === 'pass') return '✓ ';
  if (status === 'warning') return '! ';
  return '✗ ';
}

function ATFEDocument({ inputs, results }: { inputs: ATFEInputs; results: ATFEResults }) {
  const docNo = `EP-DS-ATFE-${Math.floor(Math.random() * 900) + 100}`;
  const today = new Date().toLocaleDateString('en-GB');
  const modeLabel = results.mode === 'preliminary' ? 'Preliminary (Budgetary Estimate)' : 'Detailed';

  return el(Document, {},
    el(Page, { size: 'A4', style: styles.page },
      // Header
      el(View, { style: styles.header },
        el(Text, { style: styles.headerTitle }, 'EcoProcess — ATFE Sizing Datasheet'),
        el(Text, { style: styles.headerSub }, `Doc: ${docNo}  |  Rev: 0  |  Date: ${today}  |  Mode: ${modeLabel}`),
      ),

      // Budgetary badge
      results.mode === 'preliminary' && el(View, { style: styles.badge },
        el(Text, { style: styles.badgeText }, 'BUDGETARY ESTIMATE — Not for procurement'),
      ),

      // Two-column layout
      el(View, { style: styles.twoCol },
        // Left column
        el(View, { style: styles.col },
          el(Sec, { title: '1. General' },
            el(DocRow, { label: 'Equipment Type', value: 'Agitated Thin Film Evaporator (ATFE)' }),
            el(DocRow, { label: 'Industry', value: inputs.industry ?? '—' }),
            el(DocRow, { label: 'Application', value: inputs.application ?? '—' }),
            el(DocRow, { label: 'Requirement', value: inputs.requirement ?? '—' }),
            el(DocRow, { label: 'Feed Material', value: inputs.feedMaterialName ?? '—' }),
          ),

          el(Sec, { title: '2. Process Conditions' },
            el(DocRow, { label: 'Feed Rate', value: (inputs.feedRate ?? 0).toFixed(0), unit: 'kg/hr' }),
            el(DocRow, { label: 'Volatile (Solvent)', value: `${inputs.volatilePercent}% ${inputs.solventType}` }),
            el(DocRow, { label: 'Non-Volatile', value: `${inputs.nonVolatilePercent}%` }),
            el(DocRow, {
              label: 'Feed Temperature',
              value: inputs.feedTemperature != null ? `${inputs.feedTemperature.toFixed(1)} °C` : 'At Boiling Point',
            }),
            el(DocRow, { label: 'Operating Pressure', value: `${inputs.operatingPressure} ${inputs.pressureUnit}` }),
            el(DocRow, {
              label: 'Heating Medium',
              value: inputs.heatingMedium === 'steam'
                ? `Steam at ${inputs.steamPressure} bar(g)`
                : `${inputs.heatingMedium} at ${inputs.hotMediumTemp}°C`,
            }),
            el(DocRow, { label: 'Max Product Temp', value: (inputs.maxAllowableProductTemp ?? 0).toFixed(0), unit: '°C' }),
            el(DocRow, {
              label: 'Feed Viscosity',
              value: inputs.feedViscosityAtOpTemp != null
                ? `${inputs.feedViscosityAtOpTemp.toFixed(1)} cP (at op. temp)`
                : inputs.feedViscosityAt25 != null
                  ? `${inputs.feedViscosityAt25.toFixed(1)} cP (at 25°C)`
                  : 'Proxy (pure solvent category)',
            }),
          ),
        ),

        // Right column
        el(View, { style: styles.col },
          el(Sec, { title: '3. Thermal Design' },
            el(DocRow, { label: 'Boiling Pt at Op. Pressure', value: results.T_boil_pure.toFixed(1), unit: '°C' }),
            el(DocRow, { label: 'BPE', value: results.BPE.toFixed(2), unit: '°C' }),
            el(DocRow, { label: 'Actual Boiling Point', value: results.T_boil_actual.toFixed(1), unit: '°C' }),
            el(DocRow, { label: 'Heating Medium Temp', value: results.T_heating.toFixed(1), unit: '°C' }),
            el(DocRow, { label: 'ΔT Effective', value: results.deltaT_eff.toFixed(1), unit: '°C' }),
            el(DocRow, { label: 'λ (Watson corrected)', value: results.lambda_operating.toFixed(0), unit: 'kJ/kg' }),
            el(DocRow, { label: 'Cp feed', value: results.Cp_feed.toFixed(3), unit: 'kJ/kg·K' }),
            el(DocRow, { label: 'Q sensible', value: results.Q_sensible.toFixed(1), unit: 'kW' }),
            el(DocRow, { label: 'Q latent', value: results.Q_latent.toFixed(1), unit: 'kW' }),
            el(DocRow, { label: 'Q total', value: results.Q_total.toFixed(1), unit: 'kW' }),
            el(DocRow, { label: `U-value (${results.U_source})`, value: results.U_value.toFixed(0), unit: 'W/m²·K' }),
            el(DocRow, { label: 'Required Area', value: results.A_required.toFixed(2), unit: 'm²' }),
            el(DocRow, { label: 'Selected ATFE Size', value: results.A_selected.toFixed(1), unit: 'm²' }),
            el(DocRow, { label: 'Overdesign', value: results.overdesign_pct.toFixed(1), unit: '%' }),
          ),

          el(Sec, { title: '4. Utilities' },
            results.steamConsumption != null
              ? el(DocRow, { label: 'Steam Consumption', value: results.steamConsumption.toFixed(0), unit: 'kg/hr' })
              : el(React.Fragment, {}),
            el(DocRow, { label: 'Condenser Duty', value: results.Q_condenser.toFixed(1), unit: 'kW' }),
            el(DocRow, { label: 'Cooling Water Flow', value: results.coolingWaterFlow.toFixed(0), unit: 'kg/hr' }),
            el(DocRow, { label: 'Est. Rotor Power', value: results.rotorPower.toFixed(1), unit: 'kW' }),
          ),
        ),
      ),

      // Sanity checks
      el(Sec, { title: '5. Sanity Checks' },
        ...results.sanityChecks.map(c =>
          el(View, { key: c.id, style: styles.checkRow },
            el(Text, {}, `${checkIcon(c.status)}${c.label}: ${c.message}`),
          ),
        ),
      ),

      // Pilot triggers
      results.pilotTriggers.length > 0
        ? el(Sec, { title: '6. Pilot Testing Flags' },
            ...results.pilotTriggers.map((t, i) =>
              el(View, { key: i, style: styles.checkRow },
                el(Text, {}, `! ${t}`),
              ),
            ),
          )
        : el(React.Fragment, {}),

      // Calculation basis
      el(Sec, { title: results.pilotTriggers.length > 0 ? '7. Calculation Basis' : '6. Calculation Basis' },
        el(DocRow, {
          label: 'Mode',
          value: results.mode === 'preliminary'
            ? 'Preliminary — U from viscosity lookup table'
            : 'Detailed — U from penetration theory',
        }),
        el(DocRow, { label: 'Latent Heat Correction', value: 'Watson correlation' }),
        el(DocRow, { label: 'Property Interpolation', value: 'Linear at T_mean' }),
        el(DocRow, {
          label: 'Cp Feed',
          value: inputs.feedCp != null
            ? 'Engineer override'
            : 'Mixture: volatile_frac×Cp_solvent + NV_frac×Cp_solids',
        }),
      ),

      // Footer
      el(View, { style: styles.footer },
        el(Text, { style: styles.footerText }, 'EcoProcess Engineering Pvt. Ltd. — Confidential'),
        el(Text, { style: styles.footerText }, `${docNo} | Rev 0 | ${today}`),
      ),
    ),
  );
}

export async function POST(req: NextRequest) {
  try {
    const { inputs, results } = await req.json() as { inputs: ATFEInputs; results: ATFEResults };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer = await renderToBuffer(el(ATFEDocument, { inputs, results }) as any);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="ATFE-Datasheet.pdf"',
      },
    });
  } catch (e) {
    console.error('PDF generation error:', e);
    return NextResponse.json({ error: 'PDF generation failed' }, { status: 500 });
  }
}
