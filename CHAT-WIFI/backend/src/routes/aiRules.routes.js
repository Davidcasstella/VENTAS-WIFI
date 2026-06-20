const express = require('express');
const router = express.Router();
const aiRulesService = require('../services/aiRules.service');
const { verifyToken } = require('../middleware/auth.middleware');

// All routes require authentication
router.use(verifyToken);

/**
 * GET /api/ai-rules
 * Returns all saved AI rules.
 */
router.get('/', async (req, res) => {
    try {
        const rules = await aiRulesService.getRules();
        res.json({ success: true, rules });
    } catch (err) {
        console.error('❌ [AIRules] GET error:', err.message);
        res.status(500).json({ success: false, error: 'Error al obtener las reglas' });
    }
});

/**
 * POST /api/ai-rules
 * Saves the full list of rules (replaces all existing ones).
 * Body: { rules: Array<{ id?, title, content, enabled }> }
 */
router.post('/', async (req, res) => {
    try {
        const { rules } = req.body;
        if (!Array.isArray(rules)) {
            return res.status(400).json({ success: false, error: 'El campo "rules" debe ser un array' });
        }
        const saved = await aiRulesService.saveRules(rules);
        res.json({ success: true, rules: saved });
    } catch (err) {
        console.error('❌ [AIRules] POST error:', err.message);
        res.status(500).json({ success: false, error: 'Error al guardar las reglas' });
    }
});

/**
 * DELETE /api/ai-rules/:id
 * Deletes a single rule by ID.
 */
router.delete('/:id', async (req, res) => {
    try {
        const updated = await aiRulesService.deleteRule(req.params.id);
        res.json({ success: true, rules: updated });
    } catch (err) {
        console.error('❌ [AIRules] DELETE error:', err.message);
        res.status(500).json({ success: false, error: 'Error al eliminar la regla' });
    }
});

module.exports = router;
