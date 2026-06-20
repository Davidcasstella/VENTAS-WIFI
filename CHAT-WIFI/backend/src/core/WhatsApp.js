const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    delay
} = require('@whiskeysockets/baileys');
const { EventEmitter } = require('events');
const QRCode = require('qrcode');
const pino = require('pino');
const path = require('path');
const fs = require('fs-extra');
const config = require('../config');

class WhatsApp extends EventEmitter {
    constructor() {
        super();
        this.sock = null;
        this.state = null;
        this.saveCreds = null;
        this.status = 'disconnected'; // disconnected, connecting, waiting_qr, waiting_pairing_code, connected
        this.qr = null;
        this.pairingCode = null;
        this.pendingPairingPhone = null;
        this._pairingResolve = null; // Promise resolver for pairing code flow
        this._pairingReject = null;  // Promise rejecter for pairing code flow
        this.logger = pino({ level: config.logs.level });
        this.isRestarting = false;
        this.sessionPath = path.join(process.cwd(), 'session', config.whatsapp.sessionPath);
    }

    async init() {
        if (this.sock) {
            this.logger.warn('WhatsApp instance already exists. Use restart() instead.');
            return;
        }

        this.updateStatus('connecting');
        this.logger.info('Inicializando motor de WhatsApp...');

        try {
            const { state, saveCreds } = await useMultiFileAuthState(this.sessionPath);
            this.state = state;
            this.saveCreds = saveCreds;

            const { version } = await fetchLatestBaileysVersion();

            this.sock = makeWASocket({
                version,
                auth: this.state,
                // Suppress QR in terminal when using pairing code method
                printQRInTerminal: !this.pendingPairingPhone,
                browser: config.whatsapp.browser,
                logger: this.logger.child({ module: 'baileys' }),
                // Keep bot offline so it does NOT mark messages as read on the owner's phone.
                // When markOnlineOnConnect is true, Baileys sends read receipts automatically,
                // which silences WhatsApp notifications on the owner's device.
                markOnlineOnConnect: false,
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 0,
                syncFullHistory: false,
                // Returning undefined prevents Baileys from sending read receipts
                // for messages it fetches from the server during reconnection.
                getMessage: async () => undefined
            });

            this.registerEvents();
        } catch (error) {
            this.logger.error({ error }, 'Error initializing WhatsApp');
            this.updateStatus('disconnected');
            throw error;
        }
    }

    registerEvents() {
        if (!this.sock) return;

        this.sock.ev.on('creds.update', this.saveCreds);

        this.sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                // Pairing code flow: intercept the first QR event to request a pairing code instead
                if (this.pendingPairingPhone) {
                    const phone = this.pendingPairingPhone;
                    this.pendingPairingPhone = null; // Consume the flag (one-shot)
                    try {
                        this.logger.info(`Requesting pairing code for ${phone}...`);
                        const code = await this.sock.requestPairingCode(phone);
                        this.pairingCode = code;
                        this.updateStatus('waiting_pairing_code');
                        this.logger.info(`Pairing code generated: ${code}`);
                        // Resolve the promise so the REST endpoint can return the code
                        if (this._pairingResolve) {
                            this._pairingResolve(code);
                            this._pairingResolve = null;
                            this._pairingReject = null;
                        }
                    } catch (err) {
                        this.logger.error({ err }, 'Error requesting pairing code');
                        if (this._pairingReject) {
                            this._pairingReject(err);
                            this._pairingResolve = null;
                            this._pairingReject = null;
                        }
                    }
                    return; // Skip QR generation
                }

                // Normal QR flow
                try {
                    this.qr = await QRCode.toDataURL(qr);
                    this.updateStatus('waiting_qr');
                } catch (err) {
                    this.logger.error({ err }, 'Error converting QR to data URL');
                    this.qr = null;
                }
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                this.logger.warn(`Conexión cerrada. Status: ${statusCode}. Reconnect: ${shouldReconnect}`);
                this.qr = null;
                this.updateStatus('disconnected');

                if (shouldReconnect && !this.isRestarting) {
                    this.logger.info('Intentando reconexión automática...');
                    await delay(3000);
                    this.restart();
                } else if (statusCode === DisconnectReason.loggedOut) {
                    this.logger.error('Sesión cerrada por el usuario o servidor. Limpiando credenciales...');
                    await this.clearSession();
                }
            } else if (connection === 'open') {
                this.updateStatus('connected');
                this.qr = null;
                this.pairingCode = null;
                this.logger.info('WhatsApp conectado correctamente');
            }
        });

        this.sock.ev.on('messages.upsert', (m) => {
            if (m.type === 'notify') {
                // Filter out WhatsApp Status/Stories updates — they arrive as
                // status@broadcast and should never be processed as direct messages.
                const msg = m.messages?.[0];
                if (msg?.key?.remoteJid === 'status@broadcast') return;
                this.emit('message', m);
            }
        });
    }

    updateStatus(newStatus) {
        this.status = newStatus;
        this.emit('status-update', this.getStatus());
    }

    getStatus() {
        return {
            status: this.status,
            qr: this.qr,
            pairingCode: this.pairingCode,
            user: this.sock?.user
        };
    }

    async restart() {
        if (this.isRestarting) return;
        this.isRestarting = true;

        this.logger.info('Reiniciando conexión...');
        try {
            await this.destroy();
            await delay(1000);
            await this.init();
        } finally {
            this.isRestarting = false;
        }
    }

    /**
     * Initialize connection using pairing code instead of QR.
     * Clears any existing session, sets the pending phone flag,
     * and returns a Promise that resolves with the 8-char pairing code.
     * @param {string} phoneNumber - Phone number without + (e.g. "573028599105")
     * @returns {Promise<string>} The pairing code to enter in WhatsApp
     */
    async initWithPairingCode(phoneNumber) {
        this.logger.info(`Initiating pairing code flow for ${phoneNumber}...`);

        // Clean phone number: remove +, spaces, dashes
        const cleanPhone = phoneNumber.replace(/[^\d]/g, '');

        // Set the flag BEFORE destroying/re-init so the new connection uses it
        this.pendingPairingPhone = cleanPhone;
        this.pairingCode = null;

        // Create a promise that will be resolved when the pairing code is generated
        const codePromise = new Promise((resolve, reject) => {
            this._pairingResolve = resolve;
            this._pairingReject = reject;

            // Safety timeout: if no code is generated within 30 seconds, reject
            setTimeout(() => {
                if (this._pairingReject) {
                    this._pairingReject(new Error('Timeout waiting for pairing code generation'));
                    this._pairingResolve = null;
                    this._pairingReject = null;
                }
            }, 30000);
        });

        // Destroy current connection
        await this.destroy();

        // Clear session folder (pairing code requires a fresh, unauthenticated session)
        if (fs.existsSync(this.sessionPath)) {
            await fs.remove(this.sessionPath);
            this.logger.info('Session folder cleared for pairing code flow');
        }

        await delay(1000);

        // Re-initialize — init() will see pendingPairingPhone and act accordingly
        await this.init();

        // Wait for the pairing code to be generated inside registerEvents()
        return codePromise;
    }

    async clearSession() {
        this.logger.info('Limpiando sesión y reiniciando...');
        try {
            await this.destroy();
            if (fs.existsSync(this.sessionPath)) {
                await fs.remove(this.sessionPath);
                this.logger.info('Carpeta de sesión eliminada');
            }
            await delay(1000);
            await this.init();
        } catch (error) {
            this.logger.error({ error }, 'Error clearing session');
            await this.init(); // Intentar re-init de todos modos
        }
    }

    async destroy() {
        this.logger.info('Destruyendo instancia actual de WhatsApp...');
        if (this.sock) {
            this.sock.ev.removeAllListeners();
            try {
                this.sock.end();
            } catch (e) { }
            this.sock = null;
        }
        this.qr = null;
        this.pairingCode = null;
        this.updateStatus('disconnected');
    }
}

module.exports = new WhatsApp();
