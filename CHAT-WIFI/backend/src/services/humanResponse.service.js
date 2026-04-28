/**
 * HumanResponseService
 * 
 * Splits AI responses into 1-3 sequential messages with configurable delays
 * to simulate a real human typing in WhatsApp chat.
 * 
 * The AI decides how many parts to use (1, 2, or 3) separated by ||| or ||:
 *   1 part  → short answer (greetings, confirmations)
 *   2 parts → simple Q&A (answer + closing)
 *   3 parts → detailed explanation (opener + body + closing)
 * 
 * If the AI doesn't use any delimiter, the response is sent
 * as a single message without artificial wrapping.
 * 
 * Each sent fragment is individually recorded in the chat history
 * and emitted via Socket.io for real-time dashboard updates.
 */

const sentTracker = require('../utils/sentTracker');

const FALLBACK_INTROS = [
    'Claro, mira…',
    'Dale, te cuento…',
    'Vale, mira…',
    'Ok, te explico…',
    'Si claro, mira…',
    'Perfecto, te cuento…',
    'Claro que si, te digo…',
    'Ok, te comento…',
    'Dale, te explico…',
];

const FALLBACK_CLOSINGS = [
    'Cualquier otra duda me dices',
    'Quedo atento por si tienes otra pregunta',
    'Ahi me dices si necesitas mas info',
    'Si tienes otra duda, con gusto te ayudo',
    'Cualquier cosa me dices',
    'Ahi estoy por si necesitas algo mas',
];

const POST_FLOW_CLOSINGS = [
    'Si quieres, te explico como acceder o resolver cualquier duda',
    'Cualquier cosa que necesites saber, aqui estoy',
    'Ahi me dices si quieres que te explique algo mas del curso',
    'Si te interesa, te puedo explicar como empezar',
    'Ahi me cuentas si quieres mas detalles o como inscribirte',
    'Lo que necesites saber, me dices y te ayudo',
];

class HumanResponseService {

    constructor() {
        this._io = null;
        this._chatHistory = null;
    }

    /**
     * Inject dependencies for chat history recording.
     * Called once during app initialization.
     */
    setDependencies(io, chatHistoryService) {
        this._io = io;
        this._chatHistory = chatHistoryService;
    }

    _random(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Returns a human-like typing delay in ms based on text length.
     * Short texts (greetings) → 1.5–3s, longer texts → 3–6s, with randomization.
     * @param {string} text - The message text
     * @param {boolean} isFirstMessage - Whether this is the first message in sequence
     * @param {number} multiplier - Speed multiplier (0.5=fast, 1.0=normal, 3.0=slow)
     */
    _humanDelay(text, isFirstMessage = false, multiplier = 1.0) {
        const len = (text || '').length;
        // Base delay proportional to message length, capped
        let base;
        if (len < 30) base = 1500;       // short: "dale bro"
        else if (len < 80) base = 2500;   // medium: a sentence
        else base = 4000;                 // longer: a paragraph

        // Add randomness (±30%) to feel unpredictable
        const jitter = base * (0.7 + Math.random() * 0.6);

        // Apply global speed multiplier
        const scaled = jitter * Math.max(0.1, multiplier);

        // First message has a shorter delay (they're "already typing")
        if (isFirstMessage) return Math.floor(scaled * 0.6);

        return Math.floor(scaled);
    }

    async _showTyping(sock, jid) {
        // Intentionally disabled: sendPresenceUpdate('composing') tells WhatsApp
        // the owner is typing, which automatically marks all previous messages as
        // read — silencing notifications on the owner's physical phone.
        // The bot still responds normally; it just won't show a typing indicator.
    }

    async _clearTyping(sock, jid) {
        // Intentionally disabled: paired with _showTyping above.
    }

    /**
     * Records a sent message in chat history and emits via Socket.io.
     */
    async _recordSentMessage(rawJid, text) {
        if (!this._chatHistory) return;
        const jid = rawJid.replace(/:\d+@/, '@');
        try {
            const savedMsg = await this._chatHistory.addMessage(jid, text, true, undefined, 'bot');
            sentTracker.markSent(jid);
            if (this._io) {
                this._io.emit('chat:message', { jid, message: savedMsg });
            }
        } catch (_) { }
    }

    /**
     * Splits the AI response into 1-3 parts dynamically.
     * Recognizes both ||| (preferred) and || (common AI mistake) as delimiters.
     * If no delimiter: returns the response as a single message.
     */
    splitResponse(text, options = {}) {
        const trimmed = text.trim();

        // Check for ||| first (preferred delimiter), then || (fallback)
        let delimiter = null;
        if (trimmed.includes('|||')) {
            delimiter = '|||';
        } else if (trimmed.includes('||')) {
            delimiter = '||';
        }

        if (delimiter) {
            const parts = trimmed.split(delimiter).map(p => p.trim()).filter(p => p.length > 0);

            // Return 1, 2, or 3 parts — exactly as the AI decided
            if (parts.length >= 3) {
                return [parts[0], parts[1], parts.slice(2).join('. ')];
            }
            // 1 or 2 parts — return as-is
            return parts;
        }

        // No delimiter — single message response
        // Only add a closing if the response is very short (likely a greeting/ack)
        if (trimmed.length < 40 && options.isPostWelcomeFlow) {
            const closing = this._random(POST_FLOW_CLOSINGS);
            return [trimmed, closing];
        }

        return [trimmed];
    }

    /**
     * Sends an AI response as 1-3 human-like messages with natural delays.
     * Each individual fragment is recorded in chat history and emitted via Socket.io.
     * Delays are proportional to message length with randomization for authenticity.
     */
    async sendHumanLike(sock, jid, responseText, markBotSentFn, options = {}) {
        if (!sock || !jid || !responseText) return;

        const parts = this.splitResponse(responseText, options);
        const partCount = parts.length;

        const flowTag = options.isPostWelcomeFlow ? ' [post-flow]' : '';
        const delayMultiplier = options.delayMultiplier || 1.0;
        console.log(`🧑 [HumanResponse] Sending ${partCount}-part response to ${jid} (speed: ${delayMultiplier}x)${flowTag}`);

        for (let i = 0; i < parts.length; i++) {
            try {
                await this._showTyping(sock, jid);

                // Human-like delay: variable based on text length + randomization + multiplier
                const typingDelay = this._humanDelay(parts[i], i === 0, delayMultiplier);

                await this._sleep(typingDelay);
                markBotSentFn(jid);
                await sock.sendMessage(jid, { text: parts[i] });

                // Record each individual fragment in chat history
                await this._recordSentMessage(jid, parts[i]);

                console.log(`🧑 [HumanResponse] Part ${i + 1}/${partCount} sent (${typingDelay}ms delay): "${parts[i].substring(0, 60)}${parts[i].length > 60 ? '...' : ''}"`);
            } catch (err) {
                console.error(`❌ [HumanResponse] Part ${i + 1} failed: ${err.message}`);
            }
        }

        await this._clearTyping(sock, jid);
        console.log(`✅ [HumanResponse] Full ${partCount}-part response delivered to ${jid}`);
    }
}

module.exports = new HumanResponseService();

