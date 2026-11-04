import {randomId, toHex, fromHex, encrypt, decrypt, parseEnvelope} from './crypto.js';
const ready = Promise.all([
  chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}),
  chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})
]);
let queue = Promise.resolve();
function serialize(fn) { const result = queue.then(fn); queue = result.catch(() => {}); return result; }
const extensionPage = sender => sender.url?.startsWith(chrome.runtime.getURL(''));
async function handle(message, sender) {
  await ready;
  const {keys = {}, defaultKeyId = '', encryptionEnabled = true} = await chrome.storage.local.get(['keys','defaultKeyId','encryptionEnabled']);
  if (message.type === 'state') return {ids:Object.keys(keys), defaultKeyId, encryptionEnabled};
  if (message.type === 'create' || message.type === 'import') {
    if (!extensionPage(sender)) throw new Error('未授權');
    return serialize(async () => {
      const {keys = {}, defaultKeyId = ''} = await chrome.storage.local.get(['keys','defaultKeyId']);
      let id, key;
      if (message.type === 'create') {
        do { id = randomId(); } while (keys[id]);
        key = toHex(crypto.getRandomValues(new Uint8Array(32)));
      } else {
        const data = JSON.parse(message.value);
        id = data.id; key = data.key;
        if (data.format !== 'slack-encrypt-key' || data.encoding !== 'hex' || !/^[A-Za-z0-9]{12}$/.test(id) || typeof key !== 'string' || fromHex(key).length !== 32) throw new Error('金鑰檔格式錯誤');
        if (keys[id] && keys[id] !== key) throw new Error('代號已對應其他金鑰，拒絕覆寫');
      }
      keys[id] = key;
      await chrome.storage.local.set({keys, defaultKeyId:defaultKeyId || id});
      return {id};
    });
  }
  if (message.type === 'export') {
    if (!extensionPage(sender) || !keys[message.id]) throw new Error('找不到金鑰');
    return {value:JSON.stringify({format:'slack-encrypt-key', encoding:'hex', id:message.id, key:keys[message.id]}, null, 2)};
  }
  if (message.type === 'set-default' || message.type === 'delete-key') {
    if (!extensionPage(sender)) throw new Error('未授權');
    return serialize(async () => {
      const {keys = {}, defaultKeyId = ''} = await chrome.storage.local.get(['keys','defaultKeyId']);
      if (!Object.hasOwn(keys, message.id)) throw new Error('找不到金鑰');
      if (message.type === 'set-default') {
        await chrome.storage.local.set({defaultKeyId:message.id});
      } else {
        delete keys[message.id];
        await chrome.storage.local.set({keys, defaultKeyId:defaultKeyId === message.id ? '' : defaultKeyId});
      }
      return {};
    });
  }
  if (message.type === 'set-enabled') {
    if (!extensionPage(sender) || typeof message.enabled !== 'boolean') throw new Error('無效的加密設定或未授權');
    return serialize(async () => {
      await chrome.storage.local.set({encryptionEnabled:message.enabled}); return {};
    });
  }
  if (message.type === 'decrypt') {
    if (!sender.tab || !sender.url?.startsWith('https://app.slack.com/')) throw new Error('未授權');
    const {id} = parseEnvelope(message.text);
    if (!keys[id]) throw new Error(`尚未設定金鑰 ${id}`);
    try { return {text:await decrypt(message.text, keys[id], message.scope)}; }
    catch { throw new Error('解密失敗：金鑰、頻道或密文不符'); }
  }
  if (message.type === 'send') {
    if (sender.url?.split('#')[0] !== chrome.runtime.getURL('composer.html') || !sender.tab) throw new Error('未授權');
    if (!/^T[A-Z0-9]+\/[CDG][A-Z0-9]+$/.test(message.scope)) throw new Error('無法辨識目前對話，已停止送出');
    if (!encryptionEnabled) throw new Error('加密已關閉，請使用 Slack 原生輸入框');
    const id = defaultKeyId;
    if (!id || !keys[id]) throw new Error('尚未設定預設金鑰，已停止送出');
    const text = await encrypt(message.text, id, keys[id], message.scope);
    const latest = await chrome.storage.local.get(['keys','encryptionEnabled']);
    if (latest.encryptionEnabled === false || latest.keys?.[id] !== keys[id]) throw new Error('加密設定或金鑰已變更，請重試');
    const response = await chrome.tabs.sendMessage(sender.tab.id, {type:'deliver', text, scope:message.scope, composer:message.composer}, {frameId:0});
    if (!response?.ok) throw new Error(response?.error || 'Slack 未接受密文，草稿已保留');
    return {};
  }
  throw new Error('不支援的操作');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message,sender).then(value => respond({ok:true,...value}), error => respond({ok:false,error:error.message}));
  return true;
});
