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

function cleanTextForWhatsApp(text) {
    if (!text) return '';
    return text
        // Convert literal escaped newlines/tabs from LLM JSON into real characters
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '')
        .replace(/\\t/g, ' ')
        // Normalize line breaks
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        // Remove null bytes, control characters (except \n), and invalid unicode
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
        .replace(/[\uFFFD\u0000]/g, '')
        .trim();
}

class HumanResponseService {

    constructor() {
        this._io = null;
        this._chatHistory = null;
        // Track active sending operations per JID so we can cancel them on interruption
        this._activeSenders = new Map();
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
     * Cancel any active sending operation for the given JID.
     * Called when a new message arrives from the same client.
     */
    cancelSending(jid) {
        if (this._activeSenders.has(jid)) {
            this._activeSenders.set(jid, false);
            console.log(`🛑 [HumanResponse] Cancelled remaining parts for ${jid} (client interrupted)`);
        }
    }

    /**
     * Check if sending is still active (not cancelled) for the given JID.
     */
    _isSendingActive(jid) {
        return this._activeSenders.get(jid) === true;
    }

    /**
     * Returns a human-like typing delay in ms based on text length.
     * Short texts (greetings) → 3–5s, longer texts → 5–9s, with randomization.
     * Minimum 3 seconds between parts (except first message).
     * @param {string} text - The message text
     * @param {boolean} isFirstMessage - Whether this is the first message in sequence
     * @param {number} multiplier - Speed multiplier (0.5=fast, 1.0=normal, 3.0=slow)
     */
    _humanDelay(text, isFirstMessage = false, multiplier = 1.0) {
        const len = (text || '').length;
        // Base delay proportional to message length — increased for more natural feel
        let base;
        if (len < 30) base = 3000;       // short: "dale bro"    → 3–5s
        else if (len < 120) base = 5000;  // medium: a sentence   → 5–8s
        else base = 7000;                 // longer: a paragraph  → 7–11s

        // Add randomness (±30%) to feel unpredictable
        const jitter = base * (0.7 + Math.random() * 0.6);

        // Apply global speed multiplier
        const scaled = jitter * Math.max(0.1, multiplier);

        // First message has a shorter delay (they're "already typing")
        if (isFirstMessage) return Math.floor(scaled * 0.6);

        // Guarantee a minimum 3-second gap between non-first parts
        return Math.max(3000, Math.floor(scaled));
    }

    async _showTyping(sock, jid) {
        // Show "escribiendo..." indicator on the client's WhatsApp.
        // Note: this also marks previous messages as read on the owner's phone.
        try {
            if (sock && jid) {
                await sock.sendPresenceUpdate('composing', jid);
            }
        } catch (_) { /* ignore if socket is unavailable */ }
    }

    async _clearTyping(sock, jid) {
        // Clear the typing indicator after sending the message.
        try {
            if (sock && jid) {
                await sock.sendPresenceUpdate('paused', jid);
            }
        } catch (_) { /* ignore if socket is unavailable */ }
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
            return trimmed.split(delimiter).map(p => p.trim()).filter(p => p.length > 0);
        }

        // --- NEW FALLBACK FOR GROQ / LLAMA 3 ---
        // If the AI completely ignored the ||| instruction, we fallback to smart newline grouping.
        if (trimmed.includes('\n')) {
            const lines = trimmed.split('\n').map(l => l.trim());
            const merged = [];
            let currentBlock = [];
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (!line) continue;
                
                // Identify lines that belong to a grouped block (lists or payment methods)
                const isListItem = /^\d+\.\s/.test(line) || /^-\s/.test(line);
                const isPaymentData = /💳|🔑|👤|Nequi:|Daviplata:|Nombre:/.test(line);
                
                if (isListItem || isPaymentData) {
                    currentBlock.push(line);
                } else {
                    // It's a normal sentence. Push the accumulated block first (if any).
                    if (currentBlock.length > 0) {
                        merged.push(currentBlock.join('\n'));
                        currentBlock = [];
                    }
                    merged.push(line);
                }
            }
            // Flush any remaining block
            if (currentBlock.length > 0) {
                merged.push(currentBlock.join('\n'));
            }
            
            // Only return if it actually split something, otherwise let it fall through
            if (merged.length > 0) {
                return merged;
            }
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

        // enableTypingIndicator: true = show "escribiendo...", false = silent (owner gets phone notifications)
        const enableTyping = options.enableTypingIndicator !== false;

        // Mark this JID as actively sending
        this._activeSenders.set(jid, true);

        console.log(`🧑 [HumanResponse] Sending ${partCount}-part response to ${jid} (speed: ${delayMultiplier}x, typing: ${enableTyping})${flowTag}`);

        for (let i = 0; i < parts.length; i++) {
            // Check if sending was cancelled (client sent a new message)
            if (!this._isSendingActive(jid)) {
                console.log(`🛑 [HumanResponse] Stopped at part ${i + 1}/${partCount} — client interrupted`);
                if (enableTyping) await this._clearTyping(sock, jid);
                break;
            }

            try {
                // Show typing indicator BEFORE the delay so the client sees
                // "escribiendo..." while the bot is "thinking"
                if (enableTyping) {
                    await this._showTyping(sock, jid);
                }

                // Human-like delay: variable based on text length + randomization + multiplier
                const typingDelay = this._humanDelay(parts[i], i === 0, delayMultiplier);

                if (enableTyping) {
                    // Keep refreshing the composing state every 4s during long delays
                    // (WhatsApp auto-clears the typing indicator after ~5s of inactivity)
                    let elapsed = 0;
                    const refreshInterval = 4000;
                    while (elapsed < typingDelay) {
                        // Check cancellation during the delay too
                        if (!this._isSendingActive(jid)) break;
                        const wait = Math.min(refreshInterval, typingDelay - elapsed);
                        await this._sleep(wait);
                        elapsed += wait;
                        // Re-send composing if there's still time left
                        if (elapsed < typingDelay && this._isSendingActive(jid)) {
                            await this._showTyping(sock, jid);
                        }
                    }
                    if (!this._isSendingActive(jid)) {
                        await this._clearTyping(sock, jid);
                        console.log(`🛑 [HumanResponse] Stopped at part ${i + 1}/${partCount} during delay — client interrupted`);
                        break;
                    }
                    // Stop typing indicator, then send the message
                    await this._clearTyping(sock, jid);
                } else {
                    // No typing indicator: just wait the natural delay silently
                    await this._sleep(typingDelay);
                    if (!this._isSendingActive(jid)) break;
                }

                markBotSentFn(jid);
                const cleanText = cleanTextForWhatsApp(parts[i]);
                if (!cleanText) continue;

                let sentSuccess = false;
                for (let attempt = 1; attempt <= 3 && !sentSuccess; attempt++) {
                    try {
                        await sock.sendMessage(jid, { text: cleanText });
                        sentSuccess = true;
                    } catch (sendErr) {
                        if (attempt < 3 && (sendErr.message.includes('Connection Closed') || sendErr.message.includes('xml-not-well-formed') || sendErr.message.includes('stream errored'))) {
                            console.log(`⚠️ [HumanResponse] Part ${i + 1} attempt ${attempt} failed (${sendErr.message}). Retrying in 2s...`);
                            await this._sleep(2000);
                        } else {
                            throw sendErr;
                        }
                    }
                }

                // Record each individual fragment in chat history
                await this._recordSentMessage(jid, cleanText);

                console.log(`🧑 [HumanResponse] Part ${i + 1}/${partCount} sent (${typingDelay}ms delay): "${cleanText.substring(0, 60)}${cleanText.length > 60 ? '...' : ''}"`);
            } catch (err) {
                console.error(`❌ [HumanResponse] Part ${i + 1} failed: ${err.message}`);
            }
        }

        // Clean up
        this._activeSenders.delete(jid);
        if (enableTyping) {
            await this._clearTyping(sock, jid);
        }
        console.log(`✅ [HumanResponse] Full ${partCount}-part response delivered to ${jid}`);
    }
}

module.exports = new HumanResponseService();

