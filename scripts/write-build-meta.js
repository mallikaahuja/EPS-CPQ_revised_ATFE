const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'public');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, 'test-report-meta.json'),
  JSON.stringify({ buildTimestamp: new Date().toISOString() })
);
