// MD5 identifies keys; AES-GCM provides message encryption and authentication.
const shifts = [7,12,17,22, 5,9,14,20, 4,11,16,23, 6,10,15,21];
const constants = Uint32Array.from({length:64}, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32));
export function md5(bytes) {
  const length = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(length); padded.set(bytes); padded[bytes.length] = 0x80;
  const data = new DataView(padded.buffer);
  data.setUint32(length - 8, (bytes.length * 8) >>> 0, true);
  data.setUint32(length - 4, Math.floor(bytes.length * 8 / 2 ** 32), true);
  const state = [0x67452301,0xefcdab89,0x98badcfe,0x10325476];
  for (let offset = 0; offset < length; offset += 64) {
    let [a,b,c,d] = state;
    for (let i = 0; i < 64; i++) {
      let f, word;
      if (i < 16) { f = (b & c) | (~b & d); word = i; }
      else if (i < 32) { f = (d & b) | (~d & c); word = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; word = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); word = (7 * i) % 16; }
      const sum = (a + f + constants[i] + data.getUint32(offset + word * 4, true)) | 0;
      const shift = shifts[Math.floor(i / 16) * 4 + i % 4];
      const rotated = (sum << shift) | (sum >>> (32 - shift));
      [a,b,c,d] = [d,(b + rotated) | 0,b,c];
    }
    for (const [i,value] of [a,b,c,d].entries()) state[i] = (state[i] + value) >>> 0;
  }
  const digest = new DataView(new ArrayBuffer(16));
  state.forEach((value, i) => digest.setUint32(i * 4,value,true));
  return Array.from(new Uint8Array(digest.buffer), byte => byte.toString(16).padStart(2,'0')).join('');
}
