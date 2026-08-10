function normalizeJid(jid = '') {
    return String(jid).replace(/:\d+@/, '@');
}

function phoneFromJid(jid = '') {
    return normalizeJid(jid).replace(/@.*$/, '').replace(/\D/g, '');
}

function normalizeText(value = '') {
    return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function requestedOptOut(messages) {
    const text = messages.filter((message) => !message.fromMe).map((message) => normalizeText(message.text)).join('\n');
    return /\b(stop|detener|borrar mi numero|eliminar mi numero|no me escrib(?:a|an|as)|no quiero recibir|no mas mensajes)\b/.test(text);
}

function hasPaymentEvidence(messages) {
    const text = messages.filter((message) => !message.fromMe).map((message) => normalizeText(message.text)).join('\n');
    return /\b(ya pague|pague|he pagado|transferi|consigne|comprobante|recibo de pago|transaccion exitosa)\b/.test(text);
}

function buildPromotionCandidates({ chats = [], accessRecords = [], blockedEntries = [] } = {}) {
    const buyerJids = new Set(accessRecords.map((record) => normalizeJid(record.jid)).filter(Boolean));
    const blockedPhones = new Set(blockedEntries
        .filter((entry) => entry && entry.isActive !== false)
        .map((entry) => phoneFromJid(entry.phoneNumber || entry.jid))
        .filter(Boolean));
    const candidates = [];
    const seenJids = new Set();
    let excludedBuyers = 0;
    let excludedOptOut = 0;
    let excludedBlocked = 0;
    let excludedPaymentEvidence = 0;

    for (const conversation of chats) {
        const jid = normalizeJid(conversation.jid);
        const phone = phoneFromJid(jid);
        const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
        const inboundMessages = messages.filter((message) => !message.fromMe);
        const isDirectPhone = jid.endsWith('@s.whatsapp.net') && /^\d{8,15}$/.test(phone);
        if (!isDirectPhone || inboundMessages.length === 0 || seenJids.has(jid)) continue;
        seenJids.add(jid);
        if (buyerJids.has(jid)) {
            excludedBuyers += 1;
            continue;
        }
        if (blockedPhones.has(phoneFromJid(jid))) {
            excludedBlocked += 1;
            continue;
        }
        if (requestedOptOut(messages)) {
            excludedOptOut += 1;
            continue;
        }
        if (hasPaymentEvidence(messages)) {
            excludedPaymentEvidence += 1;
            continue;
        }
        const lastMessage = messages[messages.length - 1] || {};
        candidates.push({
            jid,
            phone,
            pushName: String(conversation.pushName || '').trim(),
            lastContactAt: lastMessage.timestamp || null,
            source: 'inbound_conversation',
        });
    }

    return {
        candidates,
        summary: { excludedBuyers, excludedBlocked, excludedOptOut, excludedPaymentEvidence },
    };
}

module.exports = { buildPromotionCandidates };
