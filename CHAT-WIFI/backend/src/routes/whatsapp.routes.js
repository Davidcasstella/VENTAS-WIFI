const express = require('express');
const router = express.Router();
const whatsapp = require('../core/WhatsApp');
const { verifyToken } = require('../middleware/auth.middleware');

// All routes are protected
router.use(verifyToken);

// GET status
router.get('/status', (req, res) => {
    res.json(whatsapp.getStatus());
});

// POST restart
router.post('/restart', async (req, res) => {
    try {
        await whatsapp.restart();
        res.json({ success: true, message: 'Reiniciando conexión...' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al reiniciar', error: error.message });
    }
});

// POST clear session
router.post('/clear-session', async (req, res) => {
    try {
        await whatsapp.clearSession();
        res.json({ success: true, message: 'Sesión eliminada y reiniciando...' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al limpiar sesión', error: error.message });
    }
});

// POST request pairing code (alternative to QR scanning)
router.post('/request-pairing-code', async (req, res) => {
    try {
        const { phoneNumber } = req.body;

        // Validate phone number: must be 10-15 digits after stripping non-numeric chars
        const cleaned = (phoneNumber || '').replace(/\D/g, '');
        if (!cleaned || cleaned.length < 10 || cleaned.length > 15) {
            return res.status(400).json({
                success: false,
                message: 'Número de teléfono inválido. Usa formato numérico: 573028599105'
            });
        }

        const pairingCode = await whatsapp.initWithPairingCode(cleaned);
        res.json({ success: true, pairingCode });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error al generar código de emparejamiento',
            error: error.message
        });
    }
});

module.exports = router;

