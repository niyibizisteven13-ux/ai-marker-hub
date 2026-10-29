import fs from 'node:fs/promises';
import { evaluateMarking } from '../server/services/exams/benchmark.js';
const file = process.argv[2];
if (!file) throw new Error('Usage: npx tsx scripts/eval-marking.ts /path/to/teacher-comparison.json');
console.log(JSON.stringify(evaluateMarking(JSON.parse(await fs.readFile(file, 'utf8'))), null, 2));
