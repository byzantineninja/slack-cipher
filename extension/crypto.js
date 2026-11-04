import {md5} from './hash.js';
import {encodeCompact, decodeCompact, randomResidue} from './encoding.js';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
export const toHex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
export function fromHex(value) {
  if (typeof value !== 'string' || !/^(?:[0-9a-f]{2})+$/.test(value)) throw new Error('無效的 hex 金鑰');
  return Uint8Array.from(value.match(/../g), pair => parseInt(pair, 16));
}
export function keyId(raw) {
  const bytes = fromHex(raw);
  if (bytes.length !== 32) throw new Error('金鑰必須為 256 bits');
  let value = BigInt(`0x${md5(bytes)}`), id = '';
  for (let i = 0; i < 12; i++) { id = alphabet[Number(value % 62n)] + id; value /= 62n; }
  return id;
}
export function parseEnvelope(text) {
  const wire = text.trim();
  const legacy = /^⚿:([A-Za-z0-9]{12}):([\u4e00-\u8dff]+[\u4e00-\u4e0d])$/.exec(wire);
  const modern = /^([\u3400-\u4dbf])([\u3400-\u4dbf]{12})([\u4e00-\u8dff]+[\u3400-\u4dbf])$/.exec(wire);
  if (!legacy && !modern) throw new Error('無效的密文格式');
  const id = legacy ? legacy[1] : Array.from(modern[2], c => alphabet[(c.charCodeAt(0) - 0x3400) % 62]).join('');
  const payload = legacy ? legacy[2] : modern[3];
  if (payload.length > 60000) throw new Error('無效的密文格式');
  const bytes = decodeCompact(payload, !!modern);
  if (bytes.length < 29 || bytes[0] !== 1) throw new Error('不支援的密文版本');
  return { id, bytes };
}
async function importKey(raw, usage) {
  const bytes = fromHex(raw);
  if (bytes.length !== 32) throw new Error('金鑰必須為 256 bits');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, [usage]);
}
const aad = (id, scope) => encoder.encode(JSON.stringify(['slack-encrypt', 1, id, scope]));
export async function encrypt(text, id, raw, scope) {
  if (!/^[A-Za-z0-9]{12}$/.test(id) || id !== keyId(raw) || !scope) throw new Error('金鑰或頻道無效');
  if (!text.trim() || encoder.encode(text).length > 20000) throw new Error('請輸入 1–20000 bytes 的文字');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:aad(id, scope)}, await importKey(raw, 'encrypt'), encoder.encode(text)));
  const payload = new Uint8Array(13 + encrypted.length);
  payload[0] = 1; payload.set(iv, 1); payload.set(encrypted, 13);
  return randomResidue(0, 1) + Array.from(id, c => randomResidue(alphabet.indexOf(c), 62)).join('') + encodeCompact(payload, true);
}
export async function decrypt(text, raw, scope) {
  const {id, bytes} = parseEnvelope(text);
  const result = await crypto.subtle.decrypt({name:'AES-GCM', iv:bytes.slice(1,13), additionalData:aad(id,scope)}, await importKey(raw,'decrypt'), bytes.slice(13));
  return decoder.decode(result);
}
