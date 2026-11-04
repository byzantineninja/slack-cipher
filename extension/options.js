const select = document.querySelector('#keys'), status = document.querySelector('#status');
async function request(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result.ok) throw new Error(result.error);
  return result;
}
async function refresh(preferred) {
  const {ids, defaultKeyId, encryptionEnabled} = await request({type:'state'});
  select.replaceChildren(...ids.map(id => { const option = document.createElement('option'); option.value = id; option.textContent = id; return option; }));
  if (ids.includes(preferred || defaultKeyId)) select.value = preferred || defaultKeyId;
  document.querySelector('#default-key').textContent = defaultKeyId ? `目前預設金鑰：${defaultKeyId}` : '尚未設定預設金鑰';
  document.querySelector('#enabled').checked = encryptionEnabled !== false;
  document.querySelector('#encryption-state').textContent = encryptionEnabled !== false ? '🔒 已啟用：送出前加密' : '已關閉：使用 Slack 原生輸入框，送出明文';
  for (const id of ['#export','#delete','#set-default']) document.querySelector(id).disabled = !ids.length;
  await refreshDrafts();
}
async function refreshDrafts() {
  const entries = Object.entries(await chrome.storage.session.get(null)).filter(([key]) => key.startsWith('draft:'));
  document.querySelector('#drafts').replaceChildren(...entries.map(([,draft]) => {
    const section = document.createElement('section'), label = document.createElement('p'), text = document.createElement('textarea');
    label.textContent = draft.scope; text.value = draft.text; text.readOnly = true; text.setAttribute('aria-label', `${draft.scope} 草稿`);
    section.append(label,text); return section;
  }));
}
chrome.storage.onChanged.addListener((_, area) => { if (area === 'session') refreshDrafts().catch(() => {}); });
function action(id, fn) {
  document.querySelector(id).addEventListener('click', async event => {
    event.currentTarget.disabled = true; status.textContent = '';
    try { await fn(); } catch (error) { status.textContent = error.message; }
    finally { event.target.disabled = false; }
  });
}
action('#create', async () => { const {id} = await request({type:'create'}); await refresh(id); status.textContent = `已建立 ${id}`; });
action('#export', async () => {
  const {value} = await request({type:'export', id:select.value});
  const url = URL.createObjectURL(new Blob([value], {type:'application/json'}));
  const a = document.createElement('a'); a.href = url; a.download = `slack-cipher-${select.value}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.querySelector('#import').addEventListener('change', async event => {
  try {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > 4096) throw new Error('金鑰檔過大');
    const {id} = await request({type:'import', value:await file.text()}); await refresh(id); status.textContent = `已匯入 ${id}`;
  } catch (error) { status.textContent = error.message; }
  finally { event.target.value = ''; }
});
action('#set-default', async () => {
  await request({type:'set-default', id:select.value});
  await refresh(); status.textContent = '已更新所有對話的預設金鑰';
});
refresh().catch(error => { status.textContent = error.message; });

let deleteId = '';
const dialog = document.querySelector('#delete-dialog');
action('#delete', async () => {
  deleteId = select.value;
  if (!deleteId) return;
  document.querySelector('#delete-warning').textContent = `確定移除金鑰 ${deleteId}？若為預設金鑰，加密送出將暫停，直到重新選擇金鑰。`;
  dialog.showModal();
});
document.querySelector('#cancel-delete').addEventListener('click', () => dialog.close());
action('#confirm-delete', async () => {
  await request({type:'delete-key', id:deleteId});
  dialog.close(); await refresh(); status.textContent = `已移除金鑰 ${deleteId}`;
});
document.querySelector('#enabled').addEventListener('change', async event => {
  const checkbox = event.target; checkbox.disabled = true;
  try { await request({type:'set-enabled', enabled:checkbox.checked}); await refresh(); status.textContent = '加密設定已更新'; }
  catch (error) { checkbox.checked = !checkbox.checked; status.textContent = error.message; }
  finally { checkbox.disabled = false; }
});
