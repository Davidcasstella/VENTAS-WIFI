const express = require('express');
const router = express.Router();
const aiProvidersService = require('../services/aiProviders.service');
const { verifyToken } = require('../middleware/auth.middleware');

// All routes are protected
router.use(verifyToken);

// GET /api/ai-providers - List all providers (masked keys)
router.get('/', async (req, res) => {
    try {
        const providers = await aiProvidersService.getProviders();
        res.json({ success: true, providers });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/ai-providers - Create or update provider
router.post('/', async (req, res) => {
    try {
        const { id, name, apiKey } = req.body;
        if (!name || (!id && !apiKey)) {
            return res.status(400).json({ success: false, message: 'Nombre y API Key son requeridos' });
        }
        const providers = await aiProvidersService.saveProvider({ id, name, apiKey });
        res.json({ success: true, message: 'Proveedor guardado correctamente', providers });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE /api/ai-providers/:id - Delete provider
router.delete('/:id', async (req, res) => {
    try {
        const providers = await aiProvidersService.deleteProvider(req.params.id);
        res.json({ success: true, message: 'Proveedor eliminado', providers });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// PUT /api/ai-providers/:id/activate - Set as active
router.put('/:id/activate', async (req, res) => {
    try {
        const providers = await aiProvidersService.setActive(req.params.id);
        res.json({ success: true, message: 'Proveedor activado', providers });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/ai-providers/:id/test - Test connection
router.post('/:id/test', async (req, res) => {
    try {
        const ok = await aiProvidersService.testConnection(req.params.id);
        if (ok) {
            res.json({ success: true, message: 'Conexión exitosa' });
        } else {
            res.status(400).json({ success: false, message: 'Error de conexión. Verifica la API Key.' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
