import { Template } from 'e2b';

if (!process.env.E2B_API_KEY) throw new Error('Set E2B_API_KEY before building the terminal template.');
const result = await Template.build(Template().fromNodeImage('22'), 'bwenge-app-terminal', { cpuCount: 2, memoryMB: 1024 });
console.log(`BWENGE_TERMINAL_TEMPLATE=${result.templateId}`);
