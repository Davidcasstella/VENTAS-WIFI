const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const frontendDir = path.resolve(__dirname, '../../frontend');
const htmlPath = path.join(frontendDir, 'index.html');
const publicDir = path.join(frontendDir, 'public');

function pngSize(filePath) {
    const data = fs.readFileSync(filePath);
    assert.equal(data.subarray(1, 4).toString('ascii'), 'PNG');
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

test('frontend declares a complete standard favicon set', () => {
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.match(html, /rel="icon"[^>]+href="\/favicon-32x32\.png\?v=2"/);
    assert.match(html, /rel="icon"[^>]+href="\/favicon-16x16\.png\?v=2"/);
    assert.match(html, /rel="shortcut icon"[^>]+href="\/favicon\.ico\?v=2"/);
    assert.match(html, /rel="apple-touch-icon"[^>]+href="\/apple-touch-icon\.png\?v=2"/);
});

test('favicon assets have expected dimensions and an ICO container', () => {
    assert.deepEqual(pngSize(path.join(publicDir, 'favicon-16x16.png')), { width: 16, height: 16 });
    assert.deepEqual(pngSize(path.join(publicDir, 'favicon-32x32.png')), { width: 32, height: 32 });
    assert.deepEqual(pngSize(path.join(publicDir, 'apple-touch-icon.png')), { width: 180, height: 180 });
    const ico = fs.readFileSync(path.join(publicDir, 'favicon.ico'));
    assert.deepEqual([...ico.subarray(0, 4)], [0, 0, 1, 0]);
});
