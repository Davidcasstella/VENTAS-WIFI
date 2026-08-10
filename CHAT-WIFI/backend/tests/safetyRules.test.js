const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('enabled sales rules do not promise unauthorized hacking or spying', () => {
    const rulesPath = path.join(__dirname, '..', 'knowledge-base', 'ai-rules.json');
    const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
    const enabled = rules.filter((rule) => rule.enabled).map((rule) => String(rule.content || '')).join('\n');

    assert.doesNotMatch(enabled, /siempre\s+respond(?:e|er)\s+(?:que\s+)?s[ií]/i);
    assert.doesNotMatch(enabled, /hackear[\s\S]{0,120}(?:claro|por supuesto|s[ií]\b)/i);
    assert.match(enabled, /ciberseguridad ética/i);
    assert.match(enabled, /autorizad/i);
});
