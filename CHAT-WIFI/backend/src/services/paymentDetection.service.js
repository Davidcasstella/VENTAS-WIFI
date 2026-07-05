const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const axios = require('axios');
const aiProvidersService = require('./aiProviders.service');

// Shared prompt for both Groq and Gemini vision analysis
const VISION_PROMPT = `Analiza esta imagen y determina si es un comprobante de pago, recibo bancario, screenshot de transferencia, comprobante de Nequi, Daviplata, o cualquier prueba de pago.

Busca señales como:
- Números de transacción o referencia
- Logos de bancos o aplicaciones de pago (Nequi, Daviplata, etc.)
- Palabras como: pago, transferencia, comprobante, enviado, monto, referencia, exitoso, aprobado
- Tablas o campos de montos de dinero
- Confirmaciones de transacción

Retorna el resultado formateado exactamente así:
RESULTADO: SI
MONTO: 15000

Si no es un comprobante de pago o transferencia, responde:
RESULTADO: NO
MONTO: 0`;

/**
 * Payment Detection Service
 *
 * Downloads WhatsApp images and analyzes them using Vision APIs
 * to detect payment receipts / bank transfers.
 *
 * Provider priority:
 *   1. Gemini Vision (gemini-2.0-flash) — uses available Gemini API keys
 *   2. Groq Vision (Llama 4 Scout) — uses available Groq API keys (gsk_*)
 *
 * Rotates through all available keys before giving up.
 */
class PaymentDetectionService {

    /**
     * Download the image buffer from a WhatsApp message.
     * @param {object} msg - The Baileys message object
     * @returns {Promise<Buffer>} - The raw image buffer
     */
    async downloadImage(msg) {
        const buffer = await downloadMediaMessage(
            msg,
            'buffer',
            {},
            { reuploadRequest: undefined }
        );

        if (!buffer || buffer.length === 0) {
            throw new Error('Downloaded image buffer is empty');
        }

        console.log(`📸 Image downloaded: ${(buffer.length / 1024).toFixed(1)} KB`);
        return buffer;
    }

    /**
     * Analyze an image to determine if it's a payment receipt and extract the amount.
     * Tries Gemini Vision first, then falls back to Groq Vision.
     *
     * @param {Buffer} imageBuffer - The raw image data
     * @returns {Promise<{isPayment: boolean, amount: number}>} - Analysis result
     */
    async isPaymentReceipt(imageBuffer) {
        const base64Image = imageBuffer.toString('base64');
        let lastError = null;

        // --- Attempt 1: Gemini Vision ---
        const geminiKeys = await aiProvidersService.getProvidersByType('gemini');
        if (geminiKeys && geminiKeys.length > 0) {
            console.log(`🔍 Trying Gemini Vision (${geminiKeys.length} keys available)...`);
            for (let i = 0; i < geminiKeys.length; i++) {
                const key = geminiKeys[i];
                try {
                    const result = await this._analyzeWithGemini(key, base64Image);
                    if (i > 0) {
                        console.log(`🔄 Gemini Vision succeeded with key #${i + 1}`);
                    }
                    return result;
                } catch (error) {
                    lastError = error;
                    const status = error.response?.status || 'unknown';
                    const errMsg = error.response?.data?.error?.message || error.message || '';
                    const keyMask = key.substring(0, 4) + '...' + key.substring(key.length - 4);
                    console.warn(`🔄 Gemini key ${keyMask} failed (status: ${status}, error: ${errMsg}). ${i < geminiKeys.length - 1 ? 'Trying next...' : 'No more Gemini keys.'}`);
                }
            }
        } else {
            console.log(`⚠️ No Gemini keys available — skipping Gemini Vision`);
        }

        // --- Attempt 2: Groq Vision (fallback) ---
        const groqKeys = await aiProvidersService.getProvidersByType('groq');
        if (groqKeys && groqKeys.length > 0) {
            console.log(`🔍 Trying Groq Vision fallback (${groqKeys.length} keys available)...`);
            for (let i = 0; i < groqKeys.length; i++) {
                const key = groqKeys[i];
                try {
                    const result = await this._analyzeWithGroq(key, base64Image);
                    if (i > 0) {
                        console.log(`🔄 Groq Vision succeeded with key #${i + 1}`);
                    }
                    return result;
                } catch (error) {
                    lastError = error;
                    const status = error.response?.status || 'unknown';
                    const errMsg = error.response?.data?.error?.message || error.message || '';
                    const keyMask = key.substring(0, 4) + '...' + key.substring(key.length - 4);
                    console.warn(`🔄 Groq key ${keyMask} failed (status: ${status}, error: ${errMsg}). ${i < groqKeys.length - 1 ? 'Trying next...' : 'No more Groq keys.'}`);
                }
            }
        } else {
            console.log(`⚠️ No Groq keys available — skipping Groq Vision`);
        }

        // All providers exhausted
        throw lastError || new Error('No API keys available for image analysis (tried Gemini and Groq)');
    }

    // ── Gemini Vision ─────────────────────────────────────────────────

    /**
     * Call Gemini Vision API to analyze the image.
     * @param {string} apiKey - Gemini API key
     * @param {string} base64Image - Base64 encoded image
     * @returns {Promise<{isPayment: boolean, amount: number}>}
     */
    async _analyzeWithGemini(apiKey, base64Image) {
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            {
                contents: [
                    {
                        parts: [
                            { text: VISION_PROMPT },
                            {
                                inline_data: {
                                    mime_type: 'image/jpeg',
                                    data: base64Image
                                }
                            }
                        ]
                    }
                ],
                generationConfig: {
                    maxOutputTokens: 50,
                    temperature: 0.1
                }
            },
            {
                headers: { 'Content-Type': 'application/json' },
                timeout: 30000
            }
        );

        const content = (response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
        console.log(`🔍 Gemini Vision raw response:\n${content}`);
        return this._parseVisionResponse(content);
    }

    // ── Groq Vision ───────────────────────────────────────────────────

    /**
     * Call Groq Vision API to analyze the image.
     * @param {string} apiKey - Groq API key
     * @param {string} base64Image - Base64 encoded image
     * @returns {Promise<{isPayment: boolean, amount: number}>}
     */
    async _analyzeWithGroq(apiKey, base64Image) {
        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: 'meta-llama/llama-4-scout-17b-16e-instruct',
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: VISION_PROMPT },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:image/jpeg;base64,${base64Image}`
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 50,
                temperature: 0.1
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 60000
            }
        );

        const content = (response.data?.choices?.[0]?.message?.content || '').trim();
        console.log(`🔍 Groq Vision raw response:\n${content}`);
        return this._parseVisionResponse(content);
    }

    // ── Shared response parser ────────────────────────────────────────

    /**
     * Parse the structured RESULTADO/MONTO response from any Vision provider.
     * @param {string} content - Raw text response
     * @returns {{isPayment: boolean, amount: number}}
     */
    _parseVisionResponse(content) {
        const lines = content.split('\n');
        let isPayment = false;
        let amount = 0;

        for (const line of lines) {
            const upperLine = line.toUpperCase();
            if (upperLine.includes('RESULTADO:')) {
                isPayment = upperLine.includes('SI') || upperLine.includes('SÍ');
            }
            if (upperLine.includes('MONTO:')) {
                const num = parseInt(line.replace(/[^0-9]/g, ''), 10);
                if (!isNaN(num)) {
                    amount = num;
                }
            }
        }

        console.log(`🔍 Payment detection result: isPayment=${isPayment}, amount=${amount}`);
        return { isPayment, amount };
    }

    /**
     * Full pipeline: download image → analyze for payment receipt.
     * @param {object} msg - The Baileys message object
     * @returns {Promise<{isPayment: boolean, amount: number}>} - Analysis result
     */
    async analyzeMessage(msg) {
        const imageBuffer = await this.downloadImage(msg);
        return await this.isPaymentReceipt(imageBuffer);
    }
}

module.exports = new PaymentDetectionService();
