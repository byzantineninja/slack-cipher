import {encodeCompact} from '../extension/encoding.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encrypt,decrypt,randomId,toHex,parseEnvelope,fromHex} from '../extension/crypto.js';
const raw = () => toHex(crypto.getRandomValues(new Uint8Array(32)));
test('hex keys round trip and reject malformed input', () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  assert.match(toHex(bytes), /^[0-9a-f]{64}$/);
  assert.deepEqual(fromHex(toHex(bytes)), bytes);
  for (const value of ['', 'abc', 'zz', 'AB', null, 123]) assert.throws(() => fromHex(value));
});
test('Unicode / multiline round trip and unique nonces with a stable key ID', async () => {
  const key = raw(), id = randomId(), scope = 'T123/C456', text = '你好 🔒\n<script>alert(1)</script>';
  const a = await encrypt(text,id,key,scope), b = await encrypt(text,id,key,scope);
  assert.notEqual(a,b); assert.equal(parseEnvelope(a).id,id);
  assert.equal(await decrypt(a,key,scope),text);
});
test('reject wrong key, wrong channel, altered ciphertext and altered key ID', async () => {
  const key = raw(), id = randomId(), scope = 'T123/C456';
  const text = await encrypt('secret',id,key,scope);
  await assert.rejects(decrypt(text,raw(),scope));
  await assert.rejects(decrypt(text,key,'T123/C789'));
  const {bytes} = parseEnvelope(text); bytes[bytes.length-1] ^= 1;
  await assert.rejects(decrypt(`⚿:${id}:${encodeCompact(bytes)}`,key,scope));
  await assert.rejects(decrypt(text.replace(id,randomId()),key,scope));
});
test('reject invalid envelopes, keys, blank or oversized messages', async () => {
  for (const text of ['hello','⚿:short:~一6','⚿:abcdefghijkl:!!!!','⚿:abcdefghijkl:~一6']) assert.throws(() => parseEnvelope(text));
  const key = raw(), id = randomId();
  await assert.rejects(encrypt(' ',id,key,'T1/C1'));
  await assert.rejects(encrypt('x'.repeat(20001),id,key,'T1/C1'));
  await assert.rejects(encrypt('secret',id,toHex(new Uint8Array(16)),'T1/C1'));
  assert.equal(fromHex(key).length,32);
});
test('random IDs have the agreed 12-character alphabet', () => {
  const ids = Array.from({length:1000},randomId);
  for (const id of ids) assert.match(id,/^[A-Za-z0-9]{12}$/);
  assert.equal(new Set(ids).size, ids.length);
});
