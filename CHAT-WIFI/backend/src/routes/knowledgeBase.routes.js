const express = require('express');
const multer = require('multer');
const { verifyToken } = require('../middleware/auth.middleware');
const knowledgeBaseService = require('../services/knowledgeBase.service');

const router = express.Router();

// Configure multer for memory storage (we handle file saving ourselves)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
    fileFilter: (req, file, cb) => {
        const allowed = ['.pdf', '.txt'];
        const ext = file.originalname.toLowerCase().match(/\.[^.]+$/);
        if (ext && allowed.includes(ext[0])) {
            cb(null, true);
        } else {
            cb(new Error('Only PDF and TXT files are allowed'));
        }
    }
});

// Upload a document
router.post('/upload', verifyToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file provided' });
        }

        const doc = await knowledgeBaseService.uploadAndProcess(req.file);
        res.json({
            success: true,
            message: 'Document uploaded and processing started',
            document: doc
        });
    } catch (error) {
        console.error('❌ Upload error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// List all documents
router.get('/documents', verifyToken, async (req, res) => {
    try {
        const documents = await knowledgeBaseService.getDocuments();
        res.json({ success: true, documents });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Reprocess a document
router.post('/documents/:id/reprocess', verifyToken, async (req, res) => {
    try {
        await knowledgeBaseService.reprocessDocument(req.params.id);
        res.json({ success: true, message: 'Reprocessing started' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Delete a document
router.delete('/documents/:id', verifyToken, async (req, res) => {
    try {
        await knowledgeBaseService.deleteDocument(req.params.id);
        res.json({ success: true, message: 'Document deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Search knowledge base — returns actual chatbot answer
router.post('/search', verifyToken, async (req, res) => {
    try {
        const { query } = req.body;
        if (!query) {
            return res.status(400).json({ success: false, message: 'Query is required' });
        }

        // Get the actual chatbot response (goes through RAG + AI provider)
        const aiResponseService = require('../services/aiResponse.service');
        const answer = await aiResponseService.generateResponse(query);

        res.json({
            success: true,
            hasResults: true,
            context: answer
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
