const express = require('express');
const multer = require('multer');
const { verifyToken } = require('../middleware/auth.middleware');
const knowledgeBaseService = require('../services/knowledgeBase.service');

const router = express.Router();

// Configure multer for memory storage (we handle file saving ourselves)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 200 * 1024 * 1024 }, // 200MB max (videos can be large)
    fileFilter: (req, file, cb) => {
        const allowed = ['.pdf', '.txt', '.mp4', '.mov', '.avi', '.webm', '.mkv', '.mp3', '.ogg', '.wav', '.m4a', '.aac'];
        const ext = file.originalname.toLowerCase().match(/\.[^.]+$/);
        if (ext && allowed.includes(ext[0])) {
            cb(null, true);
        } else {
            cb(new Error('Tipo de archivo no soportado. Use PDF, TXT, video (MP4/MOV/AVI/WEBM/MKV) o audio (MP3/OGG/WAV/M4A/AAC)'));
        }
    }
});

// Upload a document (supports PDF, TXT, video and audio)
router.post('/upload', verifyToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file provided' });
        }

        const description = req.body.description || '';
        const doc = await knowledgeBaseService.uploadAndProcess(req.file, description);
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

// Update description of a document (for video/audio re-indexing)
router.patch('/documents/:id/description', verifyToken, async (req, res) => {
    try {
        const { description } = req.body;
        const updated = await fileStorage.updateDocumentStatus(req.params.id, { description: description || '' });
        if (!updated) return res.status(404).json({ success: false, message: 'Document not found' });
        // Re-process so the new description gets embedded
        knowledgeBaseService.reprocessDocument(req.params.id).catch(() => {});
        res.json({ success: true, document: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Stream / serve a stored media file (video or audio)
router.get('/documents/:id/media', verifyToken, async (req, res) => {
    try {
        const index = await fileStorage.getIndex();
        const doc = index.find(d => d.id === req.params.id);
        if (!doc) return res.status(404).json({ success: false, message: 'Not found' });

        const docPath = await fileStorage.getDocumentPath(req.params.id);
        const fs = require('fs');
        if (!docPath || !fs.existsSync(docPath)) {
            return res.status(404).json({ success: false, message: 'File not found on disk' });
        }

        const mimeMap = {
            '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
            '.webm': 'video/webm', '.mkv': 'video/x-matroska',
            '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
            '.m4a': 'audio/mp4', '.aac': 'audio/aac'
        };
        const path = require('path');
        const ext = path.extname(doc.storedName).toLowerCase();
        const mime = mimeMap[ext] || 'application/octet-stream';

        const stat = fs.statSync(docPath);
        const fileSize = stat.size;
        const range = req.headers.range;

        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = end - start + 1;
            const stream = fs.createReadStream(docPath, { start, end });
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': mime
            });
            stream.pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': mime,
                'Content-Disposition': `inline; filename="${doc.name}"`
            });
            fs.createReadStream(docPath).pipe(res);
        }
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

// ═══════════════════════════════════════════════════════════
// MANUAL KNOWLEDGE — free-form text knowledge management
// ═══════════════════════════════════════════════════════════
const manualKnowledgeService = require('../services/manualKnowledge.service');

// List all manual knowledge entries
router.get('/manual-knowledge', verifyToken, async (req, res) => {
    try {
        const entries = await manualKnowledgeService.getAll();
        res.json({ success: true, entries });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Create a new manual knowledge entry
router.post('/manual-knowledge', verifyToken, async (req, res) => {
    try {
        const { title, content } = req.body;
        if (!title || !content) {
            return res.status(400).json({ success: false, message: 'title and content are required' });
        }
        const entry = await manualKnowledgeService.create(title, content);
        res.json({ success: true, entry });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Re-vectorize all manual knowledge entries (must be BEFORE /:id routes)
router.post('/manual-knowledge/reprocess', verifyToken, async (req, res) => {
    try {
        const count = await manualKnowledgeService.reprocessAll();
        res.json({ success: true, message: `${count} entries re-vectorized`, count });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Update an existing manual knowledge entry
router.put('/manual-knowledge/:id', verifyToken, async (req, res) => {
    try {
        const { title, content } = req.body;
        if (!title || !content) {
            return res.status(400).json({ success: false, message: 'title and content are required' });
        }
        const entry = await manualKnowledgeService.update(req.params.id, title, content);
        if (!entry) {
            return res.status(404).json({ success: false, message: 'Manual knowledge entry not found' });
        }
        res.json({ success: true, entry });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Delete a manual knowledge entry
router.delete('/manual-knowledge/:id', verifyToken, async (req, res) => {
    try {
        const deleted = await manualKnowledgeService.delete(req.params.id);
        if (!deleted) {
            return res.status(404).json({ success: false, message: 'Manual knowledge entry not found' });
        }
        res.json({ success: true, message: 'Manual knowledge entry deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
