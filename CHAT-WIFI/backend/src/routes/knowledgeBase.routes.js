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

// ═══════════════════════════════════════════════════════════
// Q&A PAIRS — manual question/answer management
// ═══════════════════════════════════════════════════════════
const qaPairsService = require('../services/qaPairs.service');

// List all Q&A pairs
router.get('/qa-pairs', verifyToken, async (req, res) => {
    try {
        const pairs = await qaPairsService.getAll();
        res.json({ success: true, pairs });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Create a new Q&A pair
router.post('/qa-pairs', verifyToken, async (req, res) => {
    try {
        const { question, answer } = req.body;
        if (!question || !answer) {
            return res.status(400).json({ success: false, message: 'question and answer are required' });
        }
        const pair = await qaPairsService.create(question, answer);
        res.json({ success: true, pair });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Update an existing Q&A pair
router.put('/qa-pairs/:id', verifyToken, async (req, res) => {
    try {
        const { question, answer } = req.body;
        if (!question || !answer) {
            return res.status(400).json({ success: false, message: 'question and answer are required' });
        }
        const pair = await qaPairsService.update(req.params.id, question, answer);
        if (!pair) {
            return res.status(404).json({ success: false, message: 'Q&A pair not found' });
        }
        res.json({ success: true, pair });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Delete a Q&A pair
router.delete('/qa-pairs/:id', verifyToken, async (req, res) => {
    try {
        const deleted = await qaPairsService.delete(req.params.id);
        if (!deleted) {
            return res.status(404).json({ success: false, message: 'Q&A pair not found' });
        }
        res.json({ success: true, message: 'Q&A pair deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Re-vectorize all Q&A pairs (useful after switching AI providers)
router.post('/qa-pairs/reprocess', verifyToken, async (req, res) => {
    try {
        const count = await qaPairsService.reprocessAll();
        res.json({ success: true, message: `${count} Q&A pairs re-vectorized`, count });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
