import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodeCompact,decodeCompact} from '../extension/encoding.js';
import {encrypt,decrypt,parseEnvelope,toHex,randomId} from '../extension/crypto.js';
test('compact encoding round trips every padding alignment and byte value', () => {
  for (let length = 1; length <= 300; length++) {
    const bytes = Uint8Array.from({length},(_,i) => i % 256);
    assert.deepEqual(decodeCompact(encodeCompact(bytes)),bytes);
  }
  for (const length of [1024,20029]) {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    assert.deepEqual(decodeCompact(encodeCompact(bytes)),bytes);
  }
});
test('reject malformed compact encodings and nonzero padding', () => {
  for (const text of ['~','~hello0','~一f','~一0','~丁6','~一6extra']) assert.throws(() => decodeCompact(text));
});
test('compact ciphertext uses only the Unicode prefix and round trips correctly', async () => {
  const key = toHex(crypto.getRandomValues(new Uint8Array(32))), id = randomId();
  const plain = '測試訊息'.repeat(100), scope = 'T123/C456';
  const compact = await encrypt(plain,id,key,scope);
  assert.ok(compact.startsWith(`⚿:${id}:`));
  assert.equal(await decrypt(compact,key,scope),plain);
  const length = parseEnvelope(compact).bytes.length;
  assert.equal(compact.split(':')[2].length,Math.ceil(length * 8 / 14) + 2);
});
