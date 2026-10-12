import fs from 'fs';
import path from 'path';

const srcDir = path.resolve('src');
const forbiddenPatterns = [
  /bg-\[#/,
  /text-\[#/,
  /border-\[#/,
  /bg-(emerald|amber|indigo|neutral|red|blue|slate|zinc|stone)-[0-9]+/,
  /text-(emerald|amber|indigo|neutral|red|blue|slate|zinc|stone)-[0-9]+/,
  /border-(emerald|amber|indigo|neutral|red|blue|slate|zinc|stone)-[0-9]+/,
  /white\/\[/,
  /backdrop-blur/
];

function scanDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let violations = 0;

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      violations += scanDir(fullPath);
    } else if (entry.isFile() && /\.(tsx?|jsx?|css)$/.test(entry.name)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        for (const pattern of forbiddenPatterns) {
          if (pattern.test(line)) {
            console.log(`[Color Check Violation] ${path.relative(process.cwd(), fullPath)}:${idx + 1} -> ${line.trim()}`);
            violations++;
          }
        }
      });
    }
  }
  return violations;
}

console.log('Running color check against design tokens...');
const totalViolations = scanDir(srcDir);
if (totalViolations > 0) {
  console.log(`\n❌ Found ${totalViolations} color token violations.`);
  process.exit(1);
} else {
  console.log('\n✅ Zero hard-coded color violations found!');
  process.exit(0);
}
