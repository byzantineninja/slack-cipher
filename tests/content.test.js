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
  let listener, sent = [], sentTargets = [], decryptRequests = [], enabled = true, rejectNext = false, runtimeCalls = 0;
  const editor = w.document.querySelector('.ql-editor');
  w.chrome = {
    runtime:{id:'test',getURL:path => `chrome-extension://test/${path}`, onMessage:{addListener:fn => {listener = fn;}},async sendMessage(message) {
      runtimeCalls++;
      if (rejectNext) { rejectNext = false; throw new Error('Extension context invalidated.'); }
      if (message.type === 'state') {
        if (workerDown) throw new Error('worker unavailable');
        return {ok:true,defaultKeyId:noKey ? '' : 'abcdefghijkl',encryptionEnabled:enabled};
      }
      if (message.type === 'decrypt') { decryptRequests.push(message); return decryptError || message.scope !== scope ? {ok:false,error:'尚未設定金鑰或頻道不符'} : {ok:true,text:'<img src=x onerror=alert(1)>秘密'}; }
    }}
  };
  w.document.execCommand = (command, _, text) => { assert.equal(command,'insertText'); const selected = w.getSelection().getRangeAt(0).commonAncestorContainer;
    const target = (selected.nodeType === 1 ? selected : selected.parentElement).closest('.ql-editor');
    target.textContent = text; return true; };
  w.document.addEventListener('click', event => {
    if (!event.target.matches('[data-qa="texty_send_button"]')) return;
    const target = event.target.parentElement.querySelector('.ql-editor');
    sent.push(target.textContent); sentTargets.push(target); target.textContent = '';
  });
  w.eval(script);
  return {dom,w,editor,sent,sentTargets,decryptRequests,get runtimeCalls() { return runtimeCalls; },rejectNextRequest:() => { rejectNext = true; },setEnabled:async value => { enabled = value; listener({type:'settings-changed',encryptionEnabled:value},{id:'test'},() => {}); },deliver:message => new Promise(resolve => listener({type:'deliver',text:cipher,scope,...message},{id:'test'},resolve))};
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

function addThread(f, {channel = 'C789', thread = '1793685658.887849', knownClass = true, rootOnly = false} = {}) {
  const pane = f.w.document.createElement('section');
  if (knownClass) pane.className = 'p-thread_view';
  const path = `/archives/${channel}/p${thread.replace('.', '')}`;
  pane.innerHTML = `<a href="https://example.slack.com${path}${rootOnly ? '' : `?thread_ts=${thread}&cid=${channel}`}">Timestamp</a><div data-qa="message-text">${cipher}</div><div class="c-texty_input"><div class="ql-editor" contenteditable="true"></div><button data-qa="texty_send_button">Reply</button></div>`;
  f.w.document.body.append(pane);
  return {pane,root:pane.querySelector('.c-texty_input'),editor:pane.querySelector('.ql-editor'),link:pane.querySelector('a')};
}
function frameParams(frame) { return new URLSearchParams(new URL(frame.src).hash.slice(1)); }
test('thread pane has its own composer and uses its channel rather than the main route', async t => {
  const f = fixture(); t.after(() => f.dom.window.close()); await wait(200);
  const thread = addThread(f); await wait(220);
  const frames = [...f.w.document.querySelectorAll('iframe')]; assert.equal(frames.length,2);
  const frame = frames.find(node => frameParams(node).get('thread'));
  const params = frameParams(frame);
  assert.equal(params.get('scope'),'T123/C789');
  assert.equal(params.get('thread'),'1793685658.887849');
  assert.match(frame.title,/對話串/);
  assert.ok(thread.root.classList.contains('slackenc-hidden'));
  assert.ok(f.decryptRequests.some(message => message.scope === 'T123/C789'));
  const result = await f.deliver({composer:params.get('composer'),scope:'T123/C789'});
  assert.equal(result.ok,true); assert.equal(f.sentTargets[0],thread.editor);
  assert.equal(f.editor.textContent,'');
  await f.setEnabled(false);
  assert.equal(f.w.document.querySelector('iframe'),null);
  assert.equal(thread.root.classList.contains('slackenc-hidden'),false);
  assert.equal(f.editor.closest('.p-message_input').classList.contains('slackenc-hidden'),false);
});
test('switching a reused thread pane rejects the old composer before DOM observation runs', async t => {
  const f = fixture(); t.after(() => f.dom.window.close()); await wait(200);
  const thread = addThread(f); await wait(220);
  const oldFrame = [...f.w.document.querySelectorAll('iframe')].find(node => frameParams(node).get('thread'));
  const oldId = frameParams(oldFrame).get('composer');
  thread.link.href = 'https://example.slack.com/archives/C789/p1793685659999999?thread_ts=1793685659.999999';
  assert.equal((await f.deliver({composer:oldId,scope:'T123/C789'})).ok,false);
  assert.equal(f.sent.length,0);
  await wait(220);
  const next = [...f.w.document.querySelectorAll('iframe')].find(node => frameParams(node).get('thread'));
  assert.notEqual(frameParams(next).get('composer'),oldId);
  assert.equal(frameParams(next).get('thread'),'1793685659.999999');
  thread.pane.remove(); await wait(220);
  assert.equal(f.w.document.querySelectorAll('iframe').length,1);
});
test('discover thread wrappers without main input classes and identify new threads by root permalink', async t => {
  const f = fixture(); t.after(() => f.dom.window.close()); await wait(200);
  const thread = addThread(f,{knownClass:false}); await wait(220);
  assert.ok(thread.root.classList.contains('slackenc-hidden'));
  thread.pane.remove();
  const fresh = addThread(f,{rootOnly:true}); await wait(220);
  const frame = [...f.w.document.querySelectorAll('iframe')].find(node => frameParams(node).get('thread'));
  assert.equal(frameParams(frame).get('thread'),'1793685658.887849');
  assert.ok(fresh.root.classList.contains('slackenc-hidden'));
});
test('unidentified thread stays covered and cannot send to the main channel', async t => {
  const f = fixture(); t.after(() => f.dom.window.close()); await wait(200);
  const thread = addThread(f); thread.link.remove(); await wait(220);
  const frame = thread.root.nextElementSibling;
  const id = frameParams(frame).get('composer');
  assert.equal(frameParams(frame).get('scope'),'');
  assert.equal((await f.deliver({composer:id})).ok,false);
  await wait(220); assert.equal(thread.root.nextElementSibling,frame);
  assert.equal(f.sent.length,0);
});

test('thread list routes resolve the conversation from the thread permalink', async t => {
  const f = fixture(); t.after(() => f.dom.window.close()); await wait(200);
  f.w.history.pushState({},'', '/client/T123/threads');
  const thread = addThread(f,{channel:'D789'}); await wait(220);
  const frame = [...f.w.document.querySelectorAll('iframe')].find(node => frameParams(node).get('thread'));
  const params = frameParams(frame);
  assert.equal(params.get('scope'),'T123/D789');
  assert.equal((await f.deliver({composer:params.get('composer'),scope:'T123/D789'})).ok,true);
  assert.equal(f.sentTargets[0],thread.editor);
});

test('invalidated runtime stops old scans, preserves drafts, and shows a single reload notice', async t => {
  const f = fixture({draft:'native draft'}); t.after(() => f.dom.window.close()); await wait(200);
  const frame = f.w.document.querySelector('iframe');
  const old = frameParams(frame).get('composer');
  f.w.chrome.runtime.id = undefined;
  f.w.chrome.runtime.getURL = () => { throw new Error('Extension context invalidated.'); };
  addThread(f); await wait(220);
  const calls = f.runtimeCalls;
  assert.equal(f.w.document.querySelectorAll('.slackenc-reload-notice').length,1);
  assert.equal(f.w.document.querySelector('iframe'),frame);
  assert.equal(f.editor.textContent,'native draft');
  assert.ok(f.editor.closest('.p-message_input').classList.contains('slackenc-hidden'));
  assert.equal(f.w.document.querySelector('.slackenc-plaintext'),null);
  assert.equal((await f.deliver({composer:old})).ok,false);
  await wait(1100);
  assert.equal(f.runtimeCalls,calls);
  assert.equal(f.w.document.querySelectorAll('.slackenc-reload-notice').length,1);
  assert.equal(f.w.document.querySelectorAll('iframe').length,1);
  assert.equal(f.sent.length,0);
});
test('runtime invalidation reported by a rejected message is handled without an uncaught error', async t => {
  const f = fixture(); t.after(() => f.dom.window.close()); await wait(200);
  f.rejectNextRequest();
  const node = f.w.document.createElement('div'); node.setAttribute('data-qa','message-text'); node.textContent = cipher;
  f.w.document.body.append(node); await wait(220);
  assert.equal(f.w.document.querySelectorAll('.slackenc-reload-notice').length,1);
  assert.equal(node.classList.contains('slackenc-hidden'),false);
  assert.equal(f.w.document.querySelector('.slackenc-error'),null);
});
test('invalidation during insertion stops delivery before clicking send', async t => {
  const f = fixture(); t.after(() => f.dom.window.close()); await wait(200);
  const composer = frameParams(f.w.document.querySelector('iframe')).get('composer');
  const insert = f.w.document.execCommand;
  f.w.document.execCommand = (...args) => {
    const result = insert(...args); f.w.chrome.runtime.id = undefined; return result;
  };
  const result = await f.deliver({composer});
  assert.equal(result.ok,false); assert.match(result.error,/重新整理/);
  assert.equal(f.sent.length,0);
  assert.equal(f.editor.textContent,cipher);
  assert.ok(f.editor.closest('.p-message_input').classList.contains('slackenc-hidden'));
  assert.equal(f.editor.closest('.p-message_input').classList.contains('slackenc-sending'),false);
});
