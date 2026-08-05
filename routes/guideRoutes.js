import express from 'express';
const router = express.Router();

router.get('/export-csv', (req, res) => {
    try {
        let csvContent = 'Student,Score,Percentage,Status\n';
        csvContent += '"Student 1","42/50","84%","Marked"\n';
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=marking_log.csv');
        res.status(200).send(csvContent);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
