'use client';
import type { CalculationMode } from '@/lib/types';

interface Props {
  mode: CalculationMode;
  onChange: (mode: CalculationMode) => void;
}

export default function ModeToggle({ mode, onChange }: Props) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-gray-600">Mode:</span>
      <div className="flex rounded-md border border-gray-300 overflow-hidden">
        <button
          type="button"
          onClick={() => onChange('preliminary')}
          className={`px-4 py-1.5 text-sm font-medium transition-colors ${
            mode === 'preliminary'
              ? 'bg-[#1B5E20] text-white'
              : 'bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          Preliminary
        </button>
        <button
          type="button"
          onClick={() => onChange('detailed')}
          className={`px-4 py-1.5 text-sm font-medium border-l border-gray-300 transition-colors ${
            mode === 'detailed'
              ? 'bg-[#1B5E20] text-white'
              : 'bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          Detailed
        </button>
      </div>
    </div>
  );
}
