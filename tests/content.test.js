import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {encodeCompact} from '../extension/encoding.js';
const script = await readFile(new URL('../extension/content.js',import.meta.url),'utf8');
const scope = 'T123/C456';
const cipher = `⚿:abcdefghijkl:${encodeCompact(Uint8Array.from({length:29},(_,i) => i === 0 ? 1 : 0))}`;
const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
function fixture({draft = '', decryptError = false, noKey = false, workerDown = false} = {}) {
  const dom = new JSDOM(`<div data-qa="message-text">${cipher}</div><div class="p-message_input"><div class="ql-editor" contenteditable="true" role="textbox">${draft}</div><button data-qa="texty_send_button">Send</button></div>`, {url:'https://app.slack.com/client/T123/C456',runScripts:'outside-only',pretendToBeVisual:true});
  const {window:w} = dom;
  let listener, sent = [], enabled = true;
  const editor = w.document.querySelector('.ql-editor');
  w.chrome = {
    runtime:{id:'test',getURL:path => `chrome-extension://test/${path}`, onMessage:{addListener:fn => {listener = fn;}},async sendMessage(message) {
      if (message.type === 'state') {
        if (workerDown) throw new Error('worker unavailable');
        return {ok:true,defaultKeyId:noKey ? '' : 'abcdefghijkl',encryptionEnabled:enabled};
      }
      if (message.type === 'decrypt') return decryptError || message.scope !== scope ? {ok:false,error:'尚未設定金鑰或頻道不符'} : {ok:true,text:'<img src=x onerror=alert(1)>秘密'};
    }}
  };
  w.document.execCommand = (command, _, text) => { assert.equal(command,'insertText'); editor.textContent = text; return true; };
  w.document.querySelector('button').addEventListener('click',() => { sent.push(editor.textContent); editor.textContent = ''; });
  w.eval(script);
  return {dom,w,editor,sent,setEnabled:async value => { enabled = value; listener({type:'settings-changed',encryptionEnabled:value},{id:'test'},() => {}); },deliver:message => new Promise(resolve => listener({type:'deliver',text:cipher,scope,...message},{id:'test'},resolve))};
}
test('replace native composer, safely render plaintext, deliver ciphertext and restore on navigation', async t => {
  const f = fixture(); t.after(() => f.dom.window.close()); await wait(250);
  const root = f.editor.closest('.p-message_input'); assert.ok(root.classList.contains('slackenc-hidden'));
  const frame = f.w.document.querySelector('iframe'); assert.ok(frame);
  const params = new URL(frame.src).hash.slice(1), composer = new URLSearchParams(params).get('composer');
  const view = f.w.document.querySelector('.slackenc-plaintext');
  assert.equal(view.textContent,'<img src=x onerror=alert(1)>秘密'); assert.equal(view.querySelector('img'),null);
  assert.equal((await f.deliver({composer})).ok,true); assert.deepEqual(f.sent,[cipher]);
  assert.equal(root.classList.contains('slackenc-sending'),false);
  f.w.history.pushState({},'', '/client/T123/C999'); f.w.dispatchEvent(new f.w.PopStateEvent('popstate')); await wait(200);
  assert.ok(f.w.document.querySelector('iframe')); assert.equal(f.w.document.querySelector('.slackenc-plaintext'),null);
  assert.equal(new URLSearchParams(new URL(f.w.document.querySelector('iframe').src).hash.slice(1)).get('scope'),'T123/C999');
  assert.equal(root.classList.contains('slackenc-hidden'),true);
  assert.equal((await f.deliver({composer})).ok,false);
});
test('preserve native drafts and reject plaintext or stale composer delivery', async t => {
  const f = fixture({draft:'existing draft'}); t.after(() => f.dom.window.close()); await wait(200);
  const composer = new URLSearchParams(new URL(f.w.document.querySelector('iframe').src).hash.slice(1)).get('composer');
  assert.equal((await f.deliver({composer})).ok,false); assert.equal(f.editor.textContent,'existing draft');
  f.editor.textContent = '';
  assert.equal((await f.deliver({composer,text:'plaintext'})).ok,false);
  assert.equal((await f.deliver({composer:'stale'})).ok,false); assert.equal(f.sent.length,0);
});
test('recycled message nodes discard old plaintext; missing key retains original ciphertext', async t => {
  const f = fixture(); t.after(() => f.dom.window.close()); await wait(200);
  f.w.document.querySelector('[data-qa="message-text"]').textContent = 'ordinary message'; await wait(200);
  assert.equal(f.w.document.querySelector('.slackenc-plaintext'),null);
  const g = fixture({decryptError:true}); t.after(() => g.dom.window.close()); await wait(200);
  assert.equal(g.w.document.querySelector('[data-qa="message-text"]').classList.contains('slackenc-hidden'),false);
  assert.match(g.w.document.querySelector('.slackenc-error').textContent,/尚未設定金鑰/);
});

test('every DM, group DM and channel stays protected even with no key or worker', async t => {
  for (const workerDown of [false,true]) {
    const f = fixture({noKey:true,workerDown}); t.after(() => f.dom.window.close());
    for (const conversation of ['C789','D789','G789']) {
      f.w.history.pushState({},'', `/client/T123/${conversation}`);
      f.w.dispatchEvent(new f.w.PopStateEvent('popstate')); await wait(180);
      assert.ok(f.w.document.querySelector('iframe'));
      assert.ok(f.editor.closest('.p-message_input').classList.contains('slackenc-hidden'));
    }
  }
});

test('global switch restores native input, keeps decryption, and rejects stale deliveries', async t => {
  const f = fixture(); t.after(() => f.dom.window.close()); await wait(200);
  const old = new URLSearchParams(new URL(f.w.document.querySelector('iframe').src).hash.slice(1)).get('composer');
  await f.setEnabled(false); await wait(200);
  assert.equal(f.w.document.querySelector('iframe'),null);
  assert.equal(f.editor.closest('.p-message_input').classList.contains('slackenc-hidden'),false);
  assert.ok(f.w.document.querySelector('.slackenc-plaintext'));
  assert.equal((await f.deliver({composer:old})).ok,false);
  await f.setEnabled(true); await wait(200);
  assert.ok(f.w.document.querySelector('iframe'));
  assert.ok(f.editor.closest('.p-message_input').classList.contains('slackenc-hidden'));
});
