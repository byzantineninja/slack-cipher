const params = new URLSearchParams(location.hash.slice(1));
const scope = params.get('scope'), composer = params.get('composer'), thread = params.get('thread') || '';
const form = document.querySelector('form'), text = document.querySelector('textarea');
const status = document.querySelector('#status'), send = document.querySelector('#send');
const encryptToggle = document.querySelector('#encrypt');
let busy = false, state = null;
function render() {
  const encrypted = encryptToggle.checked, id = state?.defaultKeyId;
  document.querySelector('#mode-title').textContent = encrypted ? (thread ? '🔒 加密回覆對話串' : '🔒 加密訊息') : (thread ? '明文回覆對話串' : '明文訊息');
  document.querySelector('#key').textContent = !scope ? '無法辨識此對話，已阻止送出' : state?.overlayVisible === false ? '覆蓋輸入框已隱藏' : !encrypted ? '這則訊息將以明文送出' : id ? `Key: ${id}` : '尚未設定金鑰：請至擴充套件設定產生或匯入金鑰';
  send.textContent = encrypted ? '加密並送出' : '明文送出';
  text.placeholder = encrypted ? '明文只輸入此處；Enter 送出，Shift+Enter 換行' : '以明文送出；Enter 送出，Shift+Enter 換行';
  encryptToggle.disabled = busy;
  send.disabled = busy || !state || !scope || state.overlayVisible === false || (encrypted && !id);
}
// Each main/thread composer starts encrypted; changing mode preserves its draft.
encryptToggle.addEventListener('change', () => { status.textContent = ''; render(); });
let draftWrites = Promise.resolve();
const draftKey = `draft:${composer}`;
function saveDraft(value) {
  draftWrites = draftWrites.catch(() => {}).then(() => value ?
    chrome.storage.session.set({[draftKey]:{scope,thread,text:value,updated:Date.now()}}) :
    chrome.storage.session.remove(draftKey));
  return draftWrites;
}
text.addEventListener('input', () => {
  saveDraft(text.value).catch(() => { status.textContent = '草稿備份失敗，切換頁面前請自行保存'; });
});
async function refresh() {
  try {
    const result = await chrome.runtime.sendMessage({type:'state'});
    if (!result.ok) throw new Error(result.error);
    state = result; render();
  } catch { state = null; encryptToggle.disabled = busy; status.textContent = '擴充套件已失效，請重新整理 Slack'; send.disabled = true; }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !text.value.trim() || send.disabled) return;
  const draft = text.value;
  busy = true; text.readOnly = true; send.disabled = true; encryptToggle.disabled = true; status.textContent = encryptToggle.checked ? '加密送出中…' : '明文送出中…';
  try {
    const result = await chrome.runtime.sendMessage({type:'send', scope, composer, encrypt:encryptToggle.checked, text:draft});
    if (!result.ok) throw new Error(result.error);
    text.value = ''; await saveDraft(''); status.textContent = 'Slack 已清空輸入框，請確認訊息送達';
  } catch (error) { status.textContent = error.message; }
  finally { busy = false; text.readOnly = false; encryptToggle.disabled = false; await refresh(); }
});
text.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault(); form.requestSubmit();
  }
});
chrome.storage.onChanged.addListener((_, area) => { if (area === 'local') refresh(); });
render();
refresh();
