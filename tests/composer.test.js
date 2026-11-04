import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const html = await readFile(new URL('../extension/composer.html',import.meta.url),'utf8');
const script = await readFile(new URL('../extension/composer.js',import.meta.url),'utf8');
const settle = () => new Promise(resolve => setTimeout(resolve,20));
function fixture(t, {key = 'abcdefghijkl', thread = ''} = {}) {
  const dom = new JSDOM(html,{url:`https://extension.test/composer.html#scope=T123%2FC456&composer=test&thread=${thread}`,runScripts:'outside-only'});
  t.after(() => dom.window.close());
  const {window:w} = dom, sent = [];
  let rejectSend = false;
  w.chrome = {runtime:{async sendMessage(message) {
    if (message.type === 'state') return {ok:true,defaultKeyId:key,overlayVisible:true};
    sent.push(message); return rejectSend ? {ok:false,error:'加密失敗'} : {ok:true};
  }},storage:{session:{async set() {},async remove() {}},onChanged:{addListener() {}}}};
  w.eval(script);
  return {w,sent,rejectSend:() => {rejectSend = true;}};
}
test('composer switches encryption locally without clearing draft or needing a key for plaintext', async t => {
  const f = fixture(t,{key:''}); await settle();
  const text = f.w.document.querySelector('textarea'), toggle = f.w.document.querySelector('#encrypt'), send = f.w.document.querySelector('#send');
  text.value = '保留我的草稿\n第二行';
  assert.ok(toggle.checked); assert.ok(send.disabled);
  toggle.checked = false; toggle.dispatchEvent(new f.w.Event('change'));
  assert.equal(send.disabled,false); assert.equal(text.value,'保留我的草稿\n第二行');
  assert.equal(send.textContent,'明文送出');
  f.w.document.querySelector('form').dispatchEvent(new f.w.Event('submit',{cancelable:true})); await settle();
  assert.equal(f.sent[0].encrypt,false); assert.equal(f.sent[0].text,'保留我的草稿\n第二行');
  assert.equal(text.value,''); assert.equal(toggle.checked,false);
});
test('new composers default to encryption; failure preserves draft and never retries as plaintext', async t => {
  const f = fixture(t,{thread:'1793685658.887849'}); await settle(); f.rejectSend();
  const text = f.w.document.querySelector('textarea'); text.value = 'secret';
  assert.match(f.w.document.querySelector('#mode-title').textContent,/加密回覆對話串/);
  f.w.document.querySelector('form').dispatchEvent(new f.w.Event('submit',{cancelable:true})); await settle();
  assert.equal(f.sent.length,1); assert.equal(f.sent[0].encrypt,true);
  assert.equal(text.value,'secret'); assert.match(f.w.document.querySelector('#status').textContent,/加密失敗/);
  assert.equal(f.w.document.querySelector('#encrypt').disabled,false);
});
