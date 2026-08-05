const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

let masterGuideFiles = [];
let studentSubmissions = [];
let evaluationResults = [];

router.post('/api/guides/upload', upload.array('files', 10), (req, res) => {
  try {
    const newEntries = req.files.map((file, index) => ({
      id: Date.now().toString() + '-' + index,
      name: file.originalname,
      fileType: file.mimetype.includes('pdf') ? 'pdf' : file.mimetype.includes('image') ? 'image' : 'text',
      url: '/uploads/' + file.filename,
      rawText: 'Sample extracted rubric/guide content ready for evaluation...',
      timestamp: new Date().toLocaleTimeString()
    }));
    masterGuideFiles.push(...newEntries);
    res.status(200).json({ success: true, data: masterGuideFiles });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/api/students/upload', upload.array('papers', 20), (req, res) => {
  try {
    const newPapers = req.files.map((file, index) => ({
      id: 'student-' + Date.now() + '-' + index,
      filename: file.originalname,
      url: '/uploads/' + file.filename,
      status: 'Pending Evaluation'
    }));
    studentSubmissions.push(...newPapers);
    res.status(200).json({ success: true, data: studentSubmissions });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/api/evaluate', (req, res) => {
  try {
    const { ruleQuery, studentId } = req.body;
    const evaluatedMark = {
      id: Date.now().toString(),
      studentId: studentId || 'Candidate Name / ID',
      ruleApplied: ruleQuery || 'Standard Rubric Verification',
      totalScore: 88,
      maxScore: 100,
      breakdown: [
        { criteria: 'Definition & Core Concepts', awarded: 28, max: 30, feedback: 'Precise terminology used.' },
        { criteria: 'Calculations / Derivations', awarded: 35, max: 40, feedback: 'Solid methodological approach.' },
        { criteria: 'Critical Analysis', awarded: 25, max: 30, feedback: 'Clear and structured conclusion.' }
      ],
      misconceptionsIdentified: [],
      timestamp: new Date().toLocaleTimeString()
    };
    evaluationResults.unshift(evaluatedMark);
    res.status(200).json({ success: true, evaluation: evaluatedMark });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/api/export/csv', (req, res) => {
  try {
    let csvContent = 'Evaluation ID,Student Reference,Score,Max Score,Timestamp\n';
    evaluationResults.forEach(item => {
      csvContent += `${item.id || ''},${item.studentReference || ''},${item.score || ''},${item.maxScore || ''},${item.timestamp || ''}\n`;
    });
    res.header('Content-Type', 'text/csv');
    res.attachment('gradebook_export.csv');
    res.send(csvContent);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
