import {test} from 'node:test';
import assert from 'node:assert/strict';
import {keyId} from '../extension/crypto.js';
let listener, storageListener, accessLevel, delivered;
const data = {};
globalThis.chrome = {
  storage:{onChanged:{addListener:fn => { storageListener = fn; }},session:{async setAccessLevel() {}},local:{
    async setAccessLevel(value) { accessLevel = value.accessLevel; },
    async get(fields) { return Object.fromEntries((typeof fields === 'string' ? [fields] : fields).filter(k => k in data).map(k => [k,structuredClone(data[k])])); },
    async set(value) { Object.assign(data,structuredClone(value)); }
  }},
  runtime:{getURL:path => `chrome-extension://test/${path}`,onMessage:{addListener:fn => { listener = fn; }}},
  tabs:{async query() { return [{id:7}]; },async sendMessage(tab,message,options) { delivered = {tab,message,options}; return {ok:true}; }}
};
await import('../extension/background.js');
const trusted = {url:'chrome-extension://test/options.html'};
const page = {url:'https://app.slack.com/client/T123/C456',tab:{id:7}};
const composer = {url:'chrome-extension://test/composer.html#scope=T123%2FC456',tab:{id:7}};
const call = (message,sender = trusted) => new Promise(resolve => listener(message,sender,resolve));
test('key lifecycle, protected storage, global default key and encrypted send', async () => {
  const {id,ok} = await call({type:'create'}); assert.ok(ok); assert.match(id,/^[A-Za-z0-9]{12}$/);
  assert.equal(accessLevel,'TRUSTED_CONTEXTS');
  const state = await call({type:'state'},page); assert.equal(state.keys,undefined); assert.deepEqual(state.ids,[id]);
  assert.equal((await call({type:'export',id},page)).ok,false);
  assert.equal(state.defaultKeyId,id);
  assert.equal((await call({type:'set-default',id},page)).ok,false);
  assert.equal((await call({type:'set-default',id})).ok,true);
  assert.equal((await call({type:'send',encrypt:true,scope:'T123/C456',composer:'abc',text:'秘密'},page)).ok,false);
  assert.equal((await call({type:'send',encrypt:true,scope:'T123/C456',composer:'abc',text:'秘密'},composer)).ok,true);
  assert.equal(delivered.tab,7); assert.deepEqual(delivered.options,{frameId:0});
  assert.ok(!delivered.message.text.includes('秘密'));
  const plain = await call({type:'decrypt',scope:'T123/C456',text:delivered.message.text},page);
  assert.equal(plain.text,'秘密');
  assert.equal((await call({type:'decrypt',scope:'T123/C999',text:delivered.message.text},page)).ok,false);
  const exported = await call({type:'export',id});
  assert.match(exported.value,/^[0-9a-f]{64}$/);
  assert.equal(keyId(exported.value),id);
  assert.equal((await call({type:'import',value:exported.value})).id,id);
  assert.equal((await call({type:'import',value:'invalid key'})).ok,false);
  for (const scope of ['T123/C999','T123/D999','T999/G999']) {
    assert.equal((await call({type:'send',encrypt:true,scope,text:'secret'},composer)).ok,true);
    assert.equal((await call({type:'decrypt',scope,text:delivered.message.text},page)).text,'secret');
  }
  assert.equal((await call({type:'send',encrypt:true,scope:'invalid',text:'secret'},composer)).ok,false);
});
test('simultaneous creates preserve keys and the existing global default', async () => {
  const created = await Promise.all(Array.from({length:10},() => call({type:'create'})));
  const state = await call({type:'state'});
  for (const result of created) assert.ok(state.ids.includes(result.id));
  assert.equal((await call({type:'state'})).defaultKeyId,state.defaultKeyId);
  await call({type:'set-default',id:created[0].id});
  assert.equal((await call({type:'state'})).defaultKeyId,created[0].id);
  assert.equal((await call({type:'set-default',id:'missing'})).ok,false);
});

test('no default key blocks sending even when another key exists', async () => {
  const previous = data.defaultKeyId;
  data.defaultKeyId = '';
  assert.equal((await call({type:'send',encrypt:true,scope:'T123/D999',text:'secret'},composer)).ok,false);
  data.defaultKeyId = previous;
});

test('overlay visibility is persistent, authorized, and does not disable reading', async () => {
  const id = (await call({type:'state'})).defaultKeyId;
  await call({type:'send',encrypt:true,scope:'T123/C456',text:'secret'},composer);
  const ciphertext = delivered.message.text;
  assert.equal((await call({type:'set-overlay',visible:false},page)).ok,false);
  assert.equal((await call({type:'set-overlay',visible:'false'})).ok,false);
  assert.equal((await call({type:'set-overlay',visible:false})).ok,true);
  assert.equal((await call({type:'state'})).overlayVisible,false);
  assert.equal((await call({type:'send',encrypt:true,scope:'T123/C456',text:'secret'},composer)).ok,false);
  assert.equal((await call({type:'decrypt',scope:'T123/C456',text:ciphertext},page)).text,'secret');
  await call({type:'set-overlay',visible:true});
  assert.equal((await call({type:'send',encrypt:true,scope:'T123/C456',text:'secret'},composer)).ok,true);
  assert.equal((await call({type:'state'})).defaultKeyId,id);
});
test('key removal preserves other keys, clears the default without silently switching, and supports restore', async () => {
  const state = await call({type:'state'}), id = state.defaultKeyId;
  const backup = (await call({type:'export',id})).value;
  assert.equal((await call({type:'delete-key',id},page)).ok,false);
  assert.equal((await call({type:'delete-key',id:'missing'})).ok,false);
  await call({type:'send',encrypt:true,scope:'T123/C456',text:'secret'},composer);
  const ciphertext = delivered.message.text;
  assert.equal((await call({type:'delete-key',id})).ok,true);
  assert.equal((await call({type:'state'})).defaultKeyId,'');
  assert.equal((await call({type:'state'})).ids.length,state.ids.length-1);
  assert.equal((await call({type:'send',encrypt:true,scope:'T123/C456',text:'secret'},composer)).ok,false);
  assert.equal((await call({type:'decrypt',scope:'T123/C456',text:ciphertext},page)).ok,false);
  assert.equal((await call({type:'export',id})).ok,false);
  assert.equal((await call({type:'import',value:backup})).ok,true);
  assert.equal((await call({type:'decrypt',scope:'T123/C456',text:ciphertext},page)).text,'secret');
  // Keep one other key: deleting the default must not activate that remaining key.
  const remaining = (await call({type:'state'})).ids.filter(other => other !== id);
  for (const other of remaining.slice(1)) await call({type:'delete-key',id:other});
  await call({type:'delete-key',id});
  assert.deepEqual((await call({type:'state'})).ids,[remaining[0]]);
  assert.equal((await call({type:'state'})).defaultKeyId,'');
  assert.equal((await call({type:'send',encrypt:true,scope:'T123/C456',text:'secret'},composer)).ok,false);
  await call({type:'set-default',id:remaining[0]});
  assert.equal((await call({type:'send',encrypt:true,scope:'T123/C456',text:'secret'},composer)).ok,true);
});
test('protected setting changes notify Slack content scripts through runtime messages', async () => {
  await call({type:'set-overlay',visible:false});
  storageListener({overlayVisible:{newValue:false}},'local');
  await new Promise(resolve => setTimeout(resolve,20));
  assert.equal(delivered.tab,7);
  assert.deepEqual(delivered.message,{type:'settings-changed',overlayVisible:false});
  assert.deepEqual(delivered.options,{frameId:0});
  await call({type:'set-overlay',visible:true});
});

test('composer mode explicitly chooses plaintext without a key or encryption without fallback', async () => {
  const previous = data.defaultKeyId; data.defaultKeyId = '';
  const plain = '明文測試\n第二行';
  assert.equal((await call({type:'send',encrypt:false,scope:'T123/C456',text:plain},composer)).ok,true);
  assert.equal(delivered.message.text,plain);
  assert.equal(delivered.message.encrypted,false);
  assert.equal((await call({type:'send',encrypt:true,scope:'T123/C456',text:plain},composer)).ok,false);
  assert.equal((await call({type:'send',scope:'T123/C456',text:plain},composer)).ok,false);
  assert.equal((await call({type:'send',encrypt:'false',scope:'T123/C456',text:plain},composer)).ok,false);
  assert.equal((await call({type:'send',encrypt:false,scope:'T123/C456',text:plain},page)).ok,false);
  data.defaultKeyId = previous;
});

test('pasted keys derive their own ID, deduplicate, and reject malformed text', async () => {
  const key = 'bc'.repeat(32), id = keyId(key);
  assert.equal((await call({type:'import',value:`  ${key.toUpperCase()}\n`})).id,id);
  const count = (await call({type:'state'})).ids.length;
  assert.equal((await call({type:'import',value:key})).id,id);
  assert.equal((await call({type:'state'})).ids.length,count);
  for (const value of ['', 'abc', 'zz'.repeat(32), 'a'.repeat(63), `${key.slice(0,32)}\n${key.slice(32)}`, null]) {
    assert.equal((await call({type:'import',value})).ok,false);
  }
  assert.equal((await call({type:'export',id})).value,key);
});
test('short ID collisions cannot overwrite an existing key', async () => {
  const incoming = 'ef'.repeat(32), id = keyId(incoming), existing = 'cd'.repeat(32);
  data.keys[id] = existing;
  const result = await call({type:'import',value:incoming});
  assert.equal(result.ok,false); assert.match(result.error,/拒絕覆寫/);
  assert.equal(data.keys[id],existing);
  delete data.keys[id];
});
