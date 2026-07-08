const { RekognitionClient, DetectLabelsCommand, DetectTextCommand } = require('@aws-sdk/client-rekognition');

/**
 * AWS Rekognition Service
 *
 * Provides image analysis capabilities using AWS Rekognition:
 * - Label detection (identifies objects, scenes, concepts)
 * - Text detection (OCR for extracting text from images)
 * - Payment receipt analysis (combines labels + OCR to detect payment proof)
 *
 * Requires AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_REGION in .env
 */
class RekognitionService {
    constructor() {
        this._client = null;
        this._available = null;
    }

    /**
     * Lazily initialize the Rekognition client.
     * Returns null if credentials are not configured.
     * @returns {RekognitionClient|null}
     */
    _getClient() {
        if (this._client) return this._client;

        const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
        const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
        const region = process.env.AWS_REGION || 'us-east-1';

        if (!accessKeyId || !secretAccessKey) {
            return null;
        }

        this._client = new RekognitionClient({
            region,
            credentials: {
                accessKeyId,
                secretAccessKey
            }
        });

        return this._client;
    }

    /**
     * Check if AWS Rekognition is configured and available.
     * @returns {boolean}
     */
    isAvailable() {
        if (this._available !== null) return this._available;
        this._available = !!this._getClient();
        if (this._available) {
            console.log(`✅ [Rekognition] AWS Rekognition configured (region: ${process.env.AWS_REGION || 'us-east-1'})`);
        } else {
            console.log('⚠️ [Rekognition] AWS credentials not configured — Rekognition disabled');
        }
        return this._available;
    }

    /**
     * Detect labels (objects, scenes, concepts) in an image.
     * @param {Buffer} imageBuffer - Raw image data
     * @param {number} [maxLabels=20] - Maximum labels to return
     * @param {number} [minConfidence=70] - Minimum confidence threshold (0-100)
     * @returns {Promise<Array<{name: string, confidence: number}>>}
     */
    async detectLabels(imageBuffer, maxLabels = 20, minConfidence = 70) {
        const client = this._getClient();
        if (!client) throw new Error('AWS Rekognition not configured');

        const command = new DetectLabelsCommand({
            Image: { Bytes: imageBuffer },
            MaxLabels: maxLabels,
            MinConfidence: minConfidence
        });

        const response = await client.send(command);
        const labels = (response.Labels || []).map(label => ({
            name: label.Name,
            confidence: Math.round(label.Confidence * 100) / 100
        }));

        console.log(`🏷️ [Rekognition] Detected ${labels.length} labels: ${labels.map(l => `${l.name}(${l.confidence}%)`).join(', ')}`);
        return labels;
    }

    /**
     * Detect and extract text from an image using OCR.
     * @param {Buffer} imageBuffer - Raw image data
     * @returns {Promise<{lines: string[], words: string[], fullText: string}>}
     */
    async detectText(imageBuffer) {
        const client = this._getClient();
        if (!client) throw new Error('AWS Rekognition not configured');

        const command = new DetectTextCommand({
            Image: { Bytes: imageBuffer }
        });

        const response = await client.send(command);
        const detections = response.TextDetections || [];

        // Separate LINE vs WORD detections
        const lines = detections
            .filter(d => d.Type === 'LINE')
            .map(d => d.DetectedText);

        const words = detections
            .filter(d => d.Type === 'WORD')
            .map(d => d.DetectedText);

        const fullText = lines.join('\n');

        console.log(`📝 [Rekognition] Detected ${lines.length} lines, ${words.length} words of text`);
        return { lines, words, fullText };
    }

    /**
     * Analyze an image to determine if it's a payment receipt.
     * Combines label detection + text OCR for robust analysis.
     *
     * @param {Buffer} imageBuffer - Raw image data
     * @returns {Promise<{isPayment: boolean, amount: number, confidence: string}>}
     */
    async analyzePaymentReceipt(imageBuffer) {
        // Run both analyses in parallel for speed
        const [labels, textResult] = await Promise.all([
            this.detectLabels(imageBuffer, 25, 50),
            this.detectText(imageBuffer)
        ]);

        // --- Step 1: Check labels for payment-related indicators ---
        const paymentLabelKeywords = [
            'receipt', 'bill', 'invoice', 'document', 'text', 'page',
            'paper', 'file', 'number', 'screenshot', 'menu', 'label',
            'phone', 'mobile phone', 'electronics', 'computer'
        ];

        const labelNames = labels.map(l => l.name.toLowerCase());
        const matchedLabels = labelNames.filter(name =>
            paymentLabelKeywords.some(kw => name.includes(kw))
        );

        const hasPaymentLabels = matchedLabels.length >= 1;
        console.log(`🏷️ [Rekognition] Payment labels matched: [${matchedLabels.join(', ')}] (${matchedLabels.length} matches)`);

        // --- Step 2: Check extracted text for payment keywords ---
        const fullTextLower = textResult.fullText.toLowerCase();

        const paymentTextKeywords = [
            // Spanish keywords
            'pago', 'transferencia', 'comprobante', 'enviado', 'exitoso', 'exitosa',
            'aprobado', 'aprobada', 'referencia', 'transacción', 'transaccion',
            'monto', 'valor', 'total', 'recibo', 'deposito', 'depósito',
            'confirmación', 'confirmacion', 'cuenta', 'banco',
            // App-specific keywords (Colombian payment apps)
            'nequi', 'daviplata', 'bancolombia', 'davivienda', 'bbva',
            'movimiento', 'enviaste', 'recibiste', 'pagaste',
            'bre-b', 'breb', 'pse', 'transfiya',
            // English keywords
            'payment', 'transfer', 'receipt', 'approved', 'successful',
            'transaction', 'reference', 'amount', 'balance'
        ];

        const matchedTextKeywords = paymentTextKeywords.filter(kw => fullTextLower.includes(kw));
        const hasPaymentText = matchedTextKeywords.length >= 2;
        console.log(`📝 [Rekognition] Payment text keywords matched: [${matchedTextKeywords.join(', ')}] (${matchedTextKeywords.length} matches)`);

        // --- Step 3: Extract amount from text ---
        let amount = 0;
        const amountPatterns = [
            // Match currency amounts: $15,000 | $15.000 | 15,000 | 15.000 | 15000
            /\$?\s?(\d{1,3}(?:[.,]\d{3})*)/g,
            // Match amounts after keywords: monto: 15000, valor: $15.000
            /(?:monto|valor|total|amount)\s*:?\s*\$?\s*(\d{1,3}(?:[.,]\d{3})*(?:\.\d{2})?)/gi
        ];

        const allNumbers = [];
        for (const pattern of amountPatterns) {
            let match;
            while ((match = pattern.exec(textResult.fullText)) !== null) {
                // Normalize: remove dots/commas used as thousands separators
                const numStr = match[1].replace(/[.,]/g, '');
                const num = parseInt(numStr, 10);
                if (!isNaN(num) && num >= 1000) {
                    allNumbers.push(num);
                }
            }
        }

        if (allNumbers.length > 0) {
            // Pick the most likely payment amount (typically 10000 or 15000 for this business)
            const businessAmounts = allNumbers.filter(n => n === 10000 || n === 15000);
            if (businessAmounts.length > 0) {
                amount = businessAmounts[0];
            } else {
                // Fall back to the largest reasonable amount
                amount = allNumbers.filter(n => n <= 1000000).sort((a, b) => b - a)[0] || 0;
            }
        }

        // --- Step 4: Final decision ---
        const isPayment = (hasPaymentLabels && hasPaymentText) ||
                          (matchedTextKeywords.length >= 3);  // Strong text match alone is enough

        const confidence = matchedTextKeywords.length >= 3 ? 'high'
            : matchedTextKeywords.length >= 2 && hasPaymentLabels ? 'medium'
            : 'low';

        console.log(`🔍 [Rekognition] Final result: isPayment=${isPayment}, amount=${amount}, confidence=${confidence}`);
        return { isPayment, amount, confidence };
    }
}

module.exports = new RekognitionService();
