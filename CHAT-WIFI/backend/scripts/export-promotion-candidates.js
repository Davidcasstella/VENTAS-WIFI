#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs-extra');
const path = require('path');
const chatHistoryService = require('../src/services/chatHistory.service');
const courseAccessService = require('../src/services/courseAccess.service');
const blockedNumbersService = require('../src/services/blockedNumbers.service');
const { buildPromotionCandidates } = require('../src/services/promotionCandidates.service');

async function main() {
    const outputPath = process.argv[2]
        ? path.resolve(process.argv[2])
        : path.join(__dirname, '../data/promotion-candidates.json');

    const conversations = await chatHistoryService.getConversations();
    const chats = [];
    for (const conversation of conversations) {
        const full = await chatHistoryService.getMessages(conversation.jid);
        chats.push({
            jid: conversation.jid,
            pushName: full.pushName || conversation.pushName || '',
            messages: Array.isArray(full.messages) ? full.messages : [],
        });
    }

    const accessRecords = await courseAccessService.getAll();
    const blockedEntries = await blockedNumbersService.getAll();
    const result = buildPromotionCandidates({ chats, accessRecords, blockedEntries });
    result.candidates.sort((a, b) => String(b.lastContactAt || '').localeCompare(String(a.lastContactAt || '')));

    const document = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        purpose: 'future_opt_in_promotion_review',
        sendingAuthorized: false,
        criteria: {
            requiresInboundConversation: true,
            excludesAnyAccessOrPaymentRecord: true,
            excludesPaymentEvidenceInMessages: true,
            excludesBlockedAndOptOutContacts: true,
            excludesGroupsBroadcastsAndInternalIds: true,
        },
        summary: {
            totalConversations: conversations.length,
            totalAccessRecords: accessRecords.length,
            totalBlockedEntries: blockedEntries.length,
            candidateCount: result.candidates.length,
            ...result.summary,
        },
        candidates: result.candidates,
    };

    await fs.ensureDir(path.dirname(outputPath));
    const temporaryPath = `${outputPath}.tmp`;
    await fs.writeJson(temporaryPath, document, { spaces: 2, mode: 0o600 });
    await fs.chmod(temporaryPath, 0o600);
    await fs.move(temporaryPath, outputPath, { overwrite: true });
    await fs.chmod(outputPath, 0o600);

    console.log(JSON.stringify({
        success: true,
        outputPath,
        generatedAt: document.generatedAt,
        summary: document.summary,
    }));
}

main().catch((error) => {
    console.error(JSON.stringify({ success: false, error: error.message }));
    process.exit(1);
});
