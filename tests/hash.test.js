import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {md5} from '../extension/hash.js';
test('MD5 matches known vectors and Node across padding and block boundaries', () => {
  const encode = value => new TextEncoder().encode(value);
  assert.equal(md5(encode('')),'d41d8cd98f00b204e9800998ecf8427e');
  assert.equal(md5(encode('abc')),'900150983cd24fb0d6963f7d28e17f72');
  assert.equal(md5(encode('message digest')),'f96b697d7cb7938d525a2f31aaf161d0');
  for (const length of [1,31,32,55,56,63,64,65,127,128,1000]) {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    assert.equal(md5(bytes),createHash('md5').update(bytes).digest('hex'));
  }
});
