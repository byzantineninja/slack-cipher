// 14 bits per CJK unified ideograph, avoiding whitespace, surrogate pairs,
// combining marks and Slack's ASCII formatting characters.
const OFFSET = 0x4e00;
export function encodeCompact(bytes) {
  if (!bytes.length) throw new Error('空白編碼');
  let buffer = 0, bits = 0, result = '';
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte; bits += 8;
    while (bits >= 14) {
      bits -= 14;
      result += String.fromCharCode(OFFSET + ((buffer >>> bits) & 0x3fff));
    }
    buffer &= (1 << bits) - 1;
  }
  const padding = bits ? 14 - bits : 0;
  if (bits) result += String.fromCharCode(OFFSET + (buffer << padding));
  return result + String.fromCharCode(OFFSET + padding);
}
export function decodeCompact(value) {
  const match = /^([\u4e00-\u8dff]+)([\u4e00-\u4e0d])$/.exec(value);
  if (!match) throw new Error('無效的精簡編碼');
  const chars = match[1], padding = match[2].charCodeAt(0) - OFFSET;
  const length = (chars.length * 14 - padding) / 8;
  if (!Number.isInteger(length) || length <= 0 || (chars.charCodeAt(chars.length - 1) - OFFSET) % (2 ** padding)) throw new Error('無效的編碼補位');
  const bytes = new Uint8Array(length);
  let buffer = 0, bits = 0, index = 0;
  for (const char of chars) {
    buffer = (buffer << 14) | (char.charCodeAt(0) - OFFSET); bits += 14;
    while (bits >= 8 && index < length) {
      bits -= 8; bytes[index++] = (buffer >>> bits) & 0xff;
    }
    buffer &= (1 << bits) - 1;
  }
  return bytes;
}
