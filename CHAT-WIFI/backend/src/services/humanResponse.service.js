/**
 * HumanResponseService
 * 
 * Splits AI responses into 3 sequential messages with configurable delays
 * to simulate a real human typing in WhatsApp chat.
 * 
 * The AI is instructed to return responses in 3 parts separated by |||:
 *   Part 1 → casual opener  (e.g. "Claro mira")
 *   Part 2 → main answer    (e.g. "El plan cuesta 15 dolares")
 *   Part 3 → brief closing  (e.g. "Cualquier cosa me dices")
 * 
 * If the AI doesn't use the ||| delimiter, the service falls back to
 * wrapping the response with random intro/closing phrases.
 * 
 * Each sent fragment is individually recorded in the chat history
 * and emitted via Socket.io for real-time dashboard updates.
 */

const sentTracker = require('../utils/sentTracker');
const RESPONSE_DELAY = parseInt(process.env.RESPONSE_DELAY, 10) || 2000;

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

    async _showTyping(sock, jid) {
        try {
            await sock.presenceSubscribe(jid);
            await sock.sendPresenceUpdate('composing', jid);
        } catch (_) { }
    }

    async _clearTyping(sock, jid) {
        try {
            await sock.sendPresenceUpdate('paused', jid);
        } catch (_) { }
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
     * Splits the AI response into exactly 3 parts.
     */
    splitResponse(text, options = {}) {
        const trimmed = text.trim();

        if (trimmed.includes('|||')) {
            const parts = trimmed.split('|||').map(p => p.trim()).filter(p => p.length > 0);

            if (parts.length === 3) {
                return parts;
            }

            if (parts.length >= 2) {
                return [
                    parts[0],
                    parts.slice(1, -1).join('. ') || parts[1],
                    parts[parts.length - 1]
                ];
            }
        }

        // Fallback: wrap with random phrases
        const intro = this._random(FALLBACK_INTROS);
        const closingPool = options.isPostWelcomeFlow ? POST_FLOW_CLOSINGS : FALLBACK_CLOSINGS;
        const closing = this._random(closingPool);

        return [intro, trimmed, closing];
    }

    /**
     * Sends an AI response as 3 human-like messages with delays and typing indicators.
     * Each individual fragment is recorded in chat history and emitted via Socket.io.
     */
    async sendHumanLike(sock, jid, responseText, markBotSentFn, options = {}) {
        if (!sock || !jid || !responseText) return;

        const parts = this.splitResponse(responseText, options);
        const delay = RESPONSE_DELAY;

        const flowTag = options.isPostWelcomeFlow ? ' [post-flow]' : '';
        console.log(`🧑 [HumanResponse] Sending 3-part response to ${jid} (delay: ${delay}ms)${flowTag}`);

        for (let i = 0; i < parts.length; i++) {
            try {
                await this._showTyping(sock, jid);

                let typingDelay;
                if (i === 0) {
                    typingDelay = Math.floor(delay * 0.5);
                } else if (i === 1) {
                    typingDelay = Math.min(delay + (parts[i].length * 15), delay * 3);
                } else {
                    typingDelay = delay;
                }

                await this._sleep(typingDelay);
                markBotSentFn(jid);
                await sock.sendMessage(jid, { text: parts[i] });

                // Record each individual fragment in chat history
                await this._recordSentMessage(jid, parts[i]);

                console.log(`🧑 [HumanResponse] Part ${i + 1}/3 sent: "${parts[i].substring(0, 60)}${parts[i].length > 60 ? '...' : ''}"`);
            } catch (err) {
                console.error(`❌ [HumanResponse] Part ${i + 1} failed: ${err.message}`);
            }
        }

        await this._clearTyping(sock, jid);
        console.log(`✅ [HumanResponse] Full 3-part response delivered to ${jid}`);
    }
}

module.exports = new HumanResponseService();
