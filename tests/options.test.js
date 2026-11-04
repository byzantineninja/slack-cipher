import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const html = await readFile(new URL('../extension/options.html',import.meta.url),'utf8');
const script = await readFile(new URL('../extension/options.js',import.meta.url),'utf8');
const settle = () => new Promise(resolve => setTimeout(resolve,20));
test('settings copy and paste key text, confirm removal, and control overlay visibility', async t => {
  const dom = new JSDOM(html,{url:'https://extension.test/options.html',runScripts:'outside-only'});
  t.after(() => dom.window.close());
  const {window:w} = dom, messages = [];
  const key = 'ab'.repeat(32); let copied = '';
  Object.defineProperty(w.navigator,'clipboard',{value:{async writeText(value) { copied = value; }}});
  let ids = ['abcdefghijkl'], defaultKeyId = ids[0], overlayVisible = true;
  w.chrome = {runtime:{async sendMessage(message) {
    messages.push(message);
    if (message.type === 'state') return {ok:true,ids,defaultKeyId,overlayVisible};
    if (message.type === 'export') return {ok:true,value:key};
    if (message.type === 'import') {
      if (message.value !== key) return {ok:false,error:'金鑰格式錯誤'};
      ids = ['abcdefghijkl']; defaultKeyId = ids[0]; return {ok:true,id:ids[0]};
    }
    if (message.type === 'delete-key') { ids = []; defaultKeyId = ''; }
    if (message.type === 'set-overlay') overlayVisible = message.visible;
    return {ok:true};
  }},storage:{session:{async get() { return {}; }},onChanged:{addListener() {}}}};
  const dialog = w.document.querySelector('dialog');
  dialog.showModal = () => dialog.setAttribute('open','');
  dialog.close = () => dialog.removeAttribute('open');
  w.eval(script); await settle();
  w.document.querySelector('#export').click(); await settle();
  assert.equal(copied,key); assert.equal(copied.includes('\n'),false);
  assert.match(w.document.querySelector('#status').textContent,/已複製/);
  assert.equal(w.document.querySelector('input[type="file"]'),null);
  w.document.querySelector('#delete').click(); await settle();
  assert.ok(dialog.hasAttribute('open'));
  assert.equal(messages.filter(m => m.type === 'delete-key').length,0);
  w.document.querySelector('#cancel-delete').click();
  assert.equal(dialog.hasAttribute('open'),false);
  w.document.querySelector('#delete').click(); await settle();
  w.document.querySelector('#confirm-delete').click(); await settle();
  assert.equal(messages.filter(m => m.type === 'delete-key').length,1);
  assert.ok(w.document.querySelector('#delete').disabled);
  assert.match(w.document.querySelector('#default-key').textContent,/尚未設定/);
  const input = w.document.querySelector('#import-key');
  input.value = 'invalid'; w.document.querySelector('#import').click(); await settle();
  assert.equal(input.value,'invalid'); assert.match(w.document.querySelector('#status').textContent,/格式錯誤/);
  input.value = key; w.document.querySelector('#import').click(); await settle();
  assert.equal(input.value,''); assert.equal(ids.length,1);
  assert.match(w.document.querySelector('#status').textContent,/已匯入/);
  const toggle = w.document.querySelector('#show-overlay');
  toggle.checked = false; toggle.dispatchEvent(new w.Event('change')); await settle();
  assert.equal(overlayVisible,false);
  assert.match(w.document.querySelector('#overlay-state').textContent,/已隱藏覆蓋輸入框/);
});
