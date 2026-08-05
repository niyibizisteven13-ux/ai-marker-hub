import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import guideRoutes from './routes/guideRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize Google Gen AI SDK correctly by passing an object with apiKey
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

app.get('/api/health', (req, res) => {
    res.json({ status: 'healthy', system: 'AI Marker Hub Backend with Gemini API (ESM)' });
});

app.post('/api/evaluate', async (req, res) => {
    try {
        const { prompt, studentContent, rubricContent } = req.body;

        const fullPrompt = `
You are an expert academic grader and professor. Evaluate the following student submission based on the provided master rubric/guide. Provide detailed criterion breakdowns, constructive feedback, and a final calculated score.

MASTER RUBRIC / EXAM GUIDE:
${rubricContent || 'Standard grading guidelines apply.'}

STUDENT SUBMISSION:
${studentContent || prompt}

Provide your evaluation in a clear, structured format.
`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: fullPrompt,
        });

        res.json({
            success: true,
            evaluation: response.text,
            timestamp: new Date()
        });
    } catch (error) {
        console.error('Gemini API Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`AI Marker Hub server running on port ${PORT} with Gemini AI ready.`);
});
