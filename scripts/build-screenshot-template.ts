import { Template } from 'e2b';

if (!process.env.E2B_API_KEY) throw new Error('Set E2B_API_KEY before building the screenshot template.');
const template = Template().fromDebianImage('bookworm').aptInstall(['chromium', 'fonts-liberation']);
const result = await Template.build(template, 'bwenge-preview-browser', { cpuCount: 2, memoryMB: 2048 });
console.log(`BWENGE_SCREENSHOT_TEMPLATE=${result.templateId}`);
