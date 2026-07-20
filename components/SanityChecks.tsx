'use client';
import type { SanityCheck } from '@/lib/types';

interface Props {
  checks: SanityCheck[];
  pilotTriggers: string[];
}

const statusIcon = (s: SanityCheck['status']) => {
  if (s === 'pass') return '✅';
  if (s === 'warning') return '⚠️';
  return '🔴';
};

export default function SanityChecks({ checks, pilotTriggers }: Props) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {checks.map(check => (
          <div key={check.id} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5 shrink-0">{statusIcon(check.status)}</span>
            <div>
              <span className="font-medium">{check.label}:</span>{' '}
              <span className="text-gray-600">{check.message}</span>
            </div>
          </div>
        ))}
      </div>

      {pilotTriggers.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-800 mb-2">⚠️ Pilot Testing Recommended</p>
          <ul className="space-y-1">
            {pilotTriggers.map((t, i) => (
              <li key={i} className="text-sm text-amber-700">• {t}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
