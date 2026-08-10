const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPromotionCandidates } = require('../src/services/promotionCandidates.service');

function chat(jid, messages, pushName = 'Cliente') {
    return { jid, pushName, messages };
}

function inbound(text, timestamp = '2026-08-01T12:00:00.000Z') {
    return { text, fromMe: false, timestamp };
}

test('keeps only direct inbound phone conversations', () => {
    const chats = [
        chat('120363000000@g.us', [inbound('Grupo')]),
        chat('status@broadcast', [inbound('Estado')]),
        chat('987654321@lid', [inbound('Identificador interno')]),
        chat('573007777777@s.whatsapp.net', [{ text: 'Mensaje saliente', fromMe: true, timestamp: '2026-08-01T12:00:00.000Z' }]),
        chat('573008888888@s.whatsapp.net', [inbound('Información')]),
    ];

    const result = buildPromotionCandidates({ chats, accessRecords: [], blockedEntries: [] });

    assert.deepEqual(result.candidates.map((entry) => entry.jid), ['573008888888@s.whatsapp.net']);
});

test('deduplicates device-specific JIDs for the same customer', () => {
    const chats = [
        chat('573006666666:12@s.whatsapp.net', [inbound('Hola')], 'Marta'),
        chat('573006666666@s.whatsapp.net', [inbound('Info', '2026-08-03T12:00:00.000Z')], 'Marta'),
    ];

    const result = buildPromotionCandidates({ chats, accessRecords: [], blockedEntries: [] });

    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].jid, '573006666666@s.whatsapp.net');
});

test('excludes conversations with payment evidence even when access records are missing', () => {
    const chats = [chat('573005555555@s.whatsapp.net', [
        inbound('Ya pagué, te envío el comprobante'),
    ])];

    const result = buildPromotionCandidates({ chats, accessRecords: [], blockedEntries: [] });

    assert.equal(result.candidates.length, 0);
    assert.equal(result.summary.excludedPaymentEvidence, 1);
});

test('excludes active blocked numbers', () => {
    const chats = [chat('573004444444@s.whatsapp.net', [inbound('Información')])];
    const blockedEntries = [{ phoneNumber: '573004444444', isActive: true }];

    const result = buildPromotionCandidates({ chats, accessRecords: [], blockedEntries });

    assert.equal(result.candidates.length, 0);
    assert.equal(result.summary.excludedBlocked, 1);
});

test('excludes contacts who requested no further messages', () => {
    const chats = [chat('573003333333@s.whatsapp.net', [
        inbound('Quiero información', '2026-08-01T12:00:00.000Z'),
        inbound('Por favor no me escriban más', '2026-08-02T12:00:00.000Z'),
    ])];

    const result = buildPromotionCandidates({ chats, accessRecords: [], blockedEntries: [] });

    assert.equal(result.candidates.length, 0);
    assert.equal(result.summary.excludedOptOut, 1);
});

test('includes inbound non-buyers and excludes every contact with an access/payment record', () => {
    const chats = [
        chat('573001111111@s.whatsapp.net', [inbound('Hola, quiero información')], 'Ana'),
        chat('573002222222@s.whatsapp.net', [inbound('Quiero el curso')], 'Luis'),
    ];
    const accessRecords = [{ jid: '573002222222@s.whatsapp.net', status: 'pending_email' }];

    const result = buildPromotionCandidates({ chats, accessRecords, blockedEntries: [] });

    assert.deepEqual(result.candidates, [{
        jid: '573001111111@s.whatsapp.net',
        phone: '573001111111',
        pushName: 'Ana',
        lastContactAt: '2026-08-01T12:00:00.000Z',
        source: 'inbound_conversation',
    }]);
    assert.equal(result.summary.excludedBuyers, 1);
});
