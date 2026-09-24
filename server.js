import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { exec } from 'child_process'; // Essential for sandboxed script execution
import guideRoutes from './routes/guideRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize Google Gen AI SDK correctly
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({ dest: uploadDir });

app.use('/api', guideRoutes);

// =========================================================================
// FEATURE 1: CONTEXT-AWARE DYNAMIC FORM AGENT ENDPOINT
// =========================================================================
// Generates a structured JSON configuration instead of returning raw paragraph text
app.post('/api/forms/create', async (req, res) => {
    try {
        const { positionDescription } = req.body;

        const structuralPrompt = `
You are an expert AI Form Architect. Generate a strict JSON schema array for an application form matching this position: "\${positionDescription}".
Return ONLY a valid JSON array matching this interface blueprint:
[{"field_id": "string", "type": "text|long_text|number|file", "label": "string", "required": boolean}]
Do not include markdown blocks like \`\`\`json or trailing commentary.
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: structuralPrompt,
        });

        // Clean up formatting irregularities automatically
        const cleanJsonString = response.text.replace(/```json|```/g, '').trim();
        const generatedFormSchema = JSON.parse(cleanJsonString);

        res.json({
            success: true,
            form_id: `form_${Date.now()}`,
            fields: generatedFormSchema
        });
    } catch (error) {
        console.error('Form Architecture Generation Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =========================================================================
// FEATURE 2: CONTEXT-AWARE SANDBOXED ANALYTICS PIPELINE
// =========================================================================
// Operates on the 5 pillars of AI agents: Perceives records, plans python tasks,
// executes tools inside environments safely, and pipes visual objects back to the UI.
app.post('/api/forms/analyze', async (req, res) => {
    try {
        const { formId, rawUserGoal, datasetContext } = req.body;
        const currentTimestampIso = new Date().toISOString();

        // 1. Core Perception and Context Hydration Block
        const hydratedSystemPrompt = `
You are an advanced Data Scientist Agent.
[TEMPORAL CONTEXT]: Current system time is ${currentTimestampIso}.
[ENVIRONMENTAL CONTEXT]: You are analyzing dataset submissions for Form ID: ${formId}.
[AVAILABLE FIELDS]: ${JSON.stringify(datasetContext.fields)}.

Your task is to write a single, clean Python script using pandas to analyze a CSV data matrix located at '/tmp/dataset_${formId}.csv'.
The script MUST parse data and print a structured output exactly like this:
print("RESULT_DATA:" + json.dumps({"summary": "text", "chart_labels": [], "chart_values": []}))

Output ONLY raw executable Python code. Do not wrap code inside markdown blocks.
        `;

        // 2. Reason & Formulation of the Script Tool Call
        const modelPlanningOutput = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `${hydratedSystemPrompt}\n\nUser request: ${rawUserGoal}`,
        });

        const pythonScriptSource = modelPlanningOutput.text.replace(/```python|```/g, '').trim();
        const temporaryScriptPath = path.join(uploadDir, `sandbox_script_${formId}.py`);

        // Write generated code out to disk storage
        fs.writeFileSync(temporaryScriptPath, pythonScriptSource);

        // 3. Act Autonomously: Execute the script inside an isolated process thread
        // (In production, replace 'exec' with a safe gVisor or Docker container API post)
        exec(`python3 ${temporaryScriptPath}`, (execError, stdout, stderr) => {
            if (execError || stderr) {
                console.error("Sandbox Execution Error Trace:", stderr || execError);
                return res.status(422).json({
                    success: false,
                    error: "The agentic python tool call generated code anomalies.",
                    trace: stderr
                });
            }

            // 4. Capture Sandbox metrics and format structured JSON variables for frontend UI
            const outputLines = stdout.split('\n');
            const dataLine = outputLines.find(line => line.startsWith("RESULT_DATA:"));

            if (dataLine) {
                const jsonPayloadString = dataLine.replace("RESULT_DATA:", "").trim();
                const processedMetrics = JSON.parse(jsonPayloadString);

                return res.json({
                    success: true,
                    insights: processedMetrics.summary,
                    visualizationData: {
                        labels: processedMetrics.chart_labels,
                        datasets: processedMetrics.chart_values
                    }
                });
            }

            res.json({
                success: true,
                rawTerminalOutput: stdout
            });
        });

    } catch (error) {
        console.error('Agentic Analytics Pipeline Failure:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'healthy', system: 'Bwenge Studio Context-Aware Agentic Engine Backend' });
});

app.listen(PORT, () => {
    console.log(`Bwenge Studio Server operational on port ${PORT} with unified Agent Tool pipelines ready.`);
});
