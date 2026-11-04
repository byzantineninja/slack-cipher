const params = new URLSearchParams(location.hash.slice(1));
const scope = params.get('scope'), composer = params.get('composer');
const form = document.querySelector('form'), text = document.querySelector('textarea');
const status = document.querySelector('#status'), send = document.querySelector('#send');
let busy = false;
let draftWrites = Promise.resolve();
const draftKey = `draft:${composer}`;
function saveDraft(value) {
  draftWrites = draftWrites.catch(() => {}).then(() => value ?
    chrome.storage.session.set({[draftKey]:{scope,text:value,updated:Date.now()}}) :
    chrome.storage.session.remove(draftKey));
  return draftWrites;
}
text.addEventListener('input', () => {
  saveDraft(text.value).catch(() => { status.textContent = '草稿備份失敗，切換頁面前請自行保存'; });
});
async function refresh() {
  try {
    const state = await chrome.runtime.sendMessage({type:'state'});
    if (!state.ok) throw new Error(state.error);
    const id = state.defaultKeyId;
    document.querySelector('#key').textContent = state.encryptionEnabled === false ? '加密已關閉，請使用 Slack 原生輸入框' : id ? `Key: ${id}` : '尚未設定金鑰：請至擴充套件設定產生或匯入金鑰';
    send.disabled = busy || !id || state.encryptionEnabled === false;
  } catch { status.textContent = '擴充套件已失效，請重新整理 Slack'; send.disabled = true; }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !text.value.trim() || send.disabled) return;
  const draft = text.value;
  busy = true; text.readOnly = true; send.disabled = true; status.textContent = '加密送出中…';
  try {
    const result = await chrome.runtime.sendMessage({type:'send', scope, composer, text:draft});
    if (!result.ok) throw new Error(result.error);
    text.value = ''; await saveDraft(''); status.textContent = 'Slack 已清空輸入框，請確認訊息送達';
  } catch (error) { status.textContent = error.message; }
  finally { busy = false; text.readOnly = false; await refresh(); }
});
text.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault(); form.requestSubmit();
  }
});
chrome.storage.onChanged.addListener((_, area) => { if (area === 'local') refresh(); });
refresh();
