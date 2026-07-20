'use client';
import { useState } from 'react';
import type { ATFEInputs, ATFEResults, CalculationMode } from '@/lib/types';
import AtfeForm from './AtfeForm';
import ResultsPanel from './ResultsPanel';
import CostingPanel from './CostingPanel';
import { calculateATFE } from '@/lib/engines/atfe';

export default function ATFEApp() {
  const [mode, setMode] = useState<CalculationMode>('preliminary');
  const [results, setResults] = useState<ATFEResults | null>(null);
  const [lastInputs, setLastInputs] = useState<ATFEInputs | null>(null);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [activeTab, setActiveTab] = useState<'sizing' | 'costing'>('sizing');

  function handleCalculate(inputs: ATFEInputs, calcMode: CalculationMode) {
    try {
      const r = calculateATFE(inputs, calcMode);
      setResults(r);
      setLastInputs(inputs);
    } catch (e) {
      console.error(e);
    }
  }

  function handleModeChange(newMode: CalculationMode) {
    setMode(newMode);
    if (lastInputs) {
      try {
        const r = calculateATFE(lastInputs, newMode);
        setResults(r);
      } catch (e) {
        console.error(e);
      }
    }
  }

  async function handleGeneratePDF() {
    if (!results || !lastInputs) return;
    setIsGeneratingPDF(true);
    try {
      const res = await fetch('/api/generate-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: lastInputs, results }),
      });
      if (!res.ok) throw new Error('PDF generation failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `EP-DS-ATFE-${Date.now()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert('PDF generation failed. Please try again.');
    } finally {
      setIsGeneratingPDF(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-gray-100 p-1 w-fit">
        {(['sizing', 'costing'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab ? 'bg-white text-[#1B5E20] shadow-sm' : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            {tab === 'sizing' ? 'Sizing' : 'Factory Costing'}
          </button>
        ))}
      </div>

      {activeTab === 'sizing' ? (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-6 items-start">
          {/* Left: Form */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h2 className="text-base font-semibold text-gray-800 mb-4">ATFE Sizing Inputs</h2>
            <AtfeForm onCalculate={handleCalculate} mode={mode} />
          </div>

          {/* Right: Results */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 lg:sticky lg:top-6">
            <h2 className="text-base font-semibold text-gray-800 mb-4">Results</h2>
            <ResultsPanel
              results={results}
              mode={mode}
              onModeChange={handleModeChange}
              inputs={lastInputs}
              onGeneratePDF={handleGeneratePDF}
              isGeneratingPDF={isGeneratingPDF}
            />
          </div>
        </div>
      ) : (
        <CostingPanel sizedArea={results?.A_selected ?? null} />
      )}
    </div>
  );
}
