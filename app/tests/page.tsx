import fs from 'fs/promises';
import path from 'path';
import type { Metadata } from 'next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const metadata: Metadata = {
  title: 'Test Report — EcoProcess',
  description: 'Build-time Jest test report for the ATFE Sizing Calculator.',
};

interface AssertionResult {
  title: string;
  fullName: string;
  status: string;
  ancestorTitles: string[];
}

interface SuiteResult {
  name: string;
  status: string;
  assertionResults: AssertionResult[];
}

interface JestReport {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  testResults: SuiteResult[];
}

interface BuildMeta {
  buildTimestamp: string;
}

async function readJSON<T>(fileName: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), 'public', fileName), 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function suiteLabel(name: string) {
  return name.split(/[\\/]/).slice(-3).join('/');
}

function StatCard({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <Card size="sm">
      <CardContent className="text-center">
        <div className={`text-2xl font-bold ${className ?? 'text-gray-800'}`}>{value}</div>
        <div className="text-xs text-gray-500 mt-1">{label}</div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'passed') {
    return <Badge className="bg-[#1B5E20] text-white hover:bg-[#1B5E20]">passed</Badge>;
  }
  if (status === 'failed') {
    return <Badge variant="destructive">failed</Badge>;
  }
  return <Badge variant="secondary">{status}</Badge>;
}

export default async function TestsPage() {
  const [report, meta] = await Promise.all([
    readJSON<JestReport>('test-report.json'),
    readJSON<BuildMeta>('test-report-meta.json'),
  ]);

  if (!report) {
    return (
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Test Report</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              No test report found yet. This page is populated by the <code>prebuild</code> script
              (<code>jest --json --outputFile=public/test-report.json</code>), which runs
              automatically before <code>npm run build</code>. In local dev (<code>next dev</code>),
              that script hasn&apos;t run — build once with <code>npm run build</code>, or run{' '}
              <code>npx jest --json --outputFile=public/test-report.json</code> manually, to
              generate it.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { numTotalTests, numPassedTests, numFailedTests, numPendingTests, testResults } = report;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-800">Build Test Report</h1>
        <p className="text-xs text-gray-500 mt-1">
          Build timestamp:{' '}
          {meta?.buildTimestamp ? new Date(meta.buildTimestamp).toLocaleString() : 'unknown'}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total" value={numTotalTests} />
        <StatCard label="Passed" value={numPassedTests} className="text-[#1B5E20]" />
        <StatCard
          label="Failed"
          value={numFailedTests}
          className={numFailedTests > 0 ? 'text-red-600' : undefined}
        />
        <StatCard label="Pending" value={numPendingTests} />
      </div>

      <div className="space-y-4">
        {testResults.map(suite => {
          const passed = suite.assertionResults.filter(a => a.status === 'passed').length;
          const total = suite.assertionResults.length;
          return (
            <Card key={suite.name}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="font-mono text-sm">{suiteLabel(suite.name)}</CardTitle>
                <Badge
                  className={
                    suite.status === 'passed'
                      ? 'bg-[#1B5E20] text-white hover:bg-[#1B5E20]'
                      : undefined
                  }
                  variant={suite.status === 'passed' ? undefined : 'destructive'}
                >
                  {passed}/{total} passed
                </Badge>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1">
                  {suite.assertionResults.map(a => (
                    <li
                      key={a.fullName}
                      className="flex items-center justify-between gap-2 text-xs py-0.5"
                    >
                      <span className="text-gray-700">
                        {a.ancestorTitles.length ? `${a.ancestorTitles.join(' › ')} › ` : ''}
                        {a.title}
                      </span>
                      <StatusBadge status={a.status} />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
