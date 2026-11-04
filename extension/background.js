import {randomId, toHex, fromHex, encrypt, decrypt, parseEnvelope} from './crypto.js';
const ready = Promise.all([
  chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}),
  chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})
]);
let queue = Promise.resolve();
function serialize(fn) { const result = queue.then(fn); queue = result.catch(() => {}); return result; }
const extensionPage = sender => sender.url?.startsWith(chrome.runtime.getURL(''));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !['keys','defaultKeyId','overlayVisible'].some(key => key in changes)) return;
  // Content scripts cannot observe protected local storage directly.
  (async () => {
    await ready;
    const {overlayVisible = true} = await chrome.storage.local.get('overlayVisible');
    const tabs = await chrome.tabs.query({url:'https://app.slack.com/*'});
    await Promise.all(tabs.map(tab => chrome.tabs.sendMessage(tab.id, {type:'settings-changed',overlayVisible}, {frameId:0}).catch(() => {})));
  })().catch(() => {});
});
async function handle(message, sender) {
  await ready;
  const {keys = {}, defaultKeyId = '', overlayVisible = true} = await chrome.storage.local.get(['keys','defaultKeyId','overlayVisible']);
  if (message.type === 'state') return {ids:Object.keys(keys), defaultKeyId, overlayVisible};
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
  if (message.type === 'set-overlay') {
    if (!extensionPage(sender) || typeof message.visible !== 'boolean') throw new Error('無效的顯示設定或未授權');
    return serialize(async () => {
      await chrome.storage.local.set({overlayVisible:message.visible}); return {};
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
    if (!overlayVisible) throw new Error('覆蓋輸入框已隱藏，請使用 Slack 原生輸入框');
    if (typeof message.encrypt !== 'boolean') throw new Error('請明確選擇加密或明文送出');
    if (typeof message.text !== 'string' || !message.text.trim() || new TextEncoder().encode(message.text).length > 20000) throw new Error('請輸入 1–20000 bytes 的文字');
    const id = defaultKeyId;
    if (message.encrypt && (!id || !keys[id])) throw new Error('尚未設定預設金鑰，已停止送出');
    const text = message.encrypt ? await encrypt(message.text, id, keys[id], message.scope) : message.text;
    const latest = await chrome.storage.local.get(['keys','overlayVisible']);
    if (latest.overlayVisible === false || (message.encrypt && latest.keys?.[id] !== keys[id])) throw new Error('顯示設定或金鑰已變更，請重試');
    const response = await chrome.tabs.sendMessage(sender.tab.id, {type:'deliver', text, encrypted:message.encrypt, scope:message.scope, composer:message.composer}, {frameId:0});
    if (!response?.ok) throw new Error(response?.error || 'Slack 未接受密文，草稿已保留');
    return {};
  }
  throw new Error('不支援的操作');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message,sender).then(value => respond({ok:true,...value}), error => respond({ok:false,error:error.message}));
  return true;
});
