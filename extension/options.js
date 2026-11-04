const select = document.querySelector('#keys'), status = document.querySelector('#status');
async function request(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result.ok) throw new Error(result.error);
  return result;
}
async function refresh(preferred) {
  const {ids, defaultKeyId, overlayVisible} = await request({type:'state'});
  select.replaceChildren(...ids.map(id => { const option = document.createElement('option'); option.value = id; option.textContent = id; return option; }));
  if (ids.includes(preferred || defaultKeyId)) select.value = preferred || defaultKeyId;
  document.querySelector('#default-key').textContent = defaultKeyId ? `目前預設金鑰：${defaultKeyId}` : '尚未設定預設金鑰';
  document.querySelector('#show-overlay').checked = overlayVisible !== false;
  document.querySelector('#overlay-state').textContent = overlayVisible !== false ? '已顯示覆蓋輸入框，可在輸入框內切換加密或明文' : '已隱藏覆蓋輸入框，使用 Slack 原生輸入框';
  for (const id of ['#export','#delete','#set-default']) document.querySelector(id).disabled = !ids.length;
  await refreshDrafts();
}
async function refreshDrafts() {
  const entries = Object.entries(await chrome.storage.session.get(null)).filter(([key]) => key.startsWith('draft:'));
  document.querySelector('#drafts').replaceChildren(...entries.map(([,draft]) => {
    const section = document.createElement('section'), label = document.createElement('p'), text = document.createElement('textarea');
    label.textContent = draft.scope + (draft.thread ? ` / 對話串 ${draft.thread}` : ''); text.value = draft.text; text.readOnly = true; text.setAttribute('aria-label', `${draft.scope} 草稿`);
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
  await navigator.clipboard.writeText(value);
  status.textContent = '金鑰已複製到剪貼簿';
});
action('#import', async () => {
  const input = document.querySelector('#import-key');
  const {id} = await request({type:'import',value:input.value});
  input.value = ''; await refresh(id); status.textContent = `已匯入 ${id}`;
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
document.querySelector('#show-overlay').addEventListener('change', async event => {
  const checkbox = event.target; checkbox.disabled = true;
  try { await request({type:'set-overlay', visible:checkbox.checked}); await refresh(); status.textContent = '覆蓋輸入框顯示設定已更新'; }
  catch (error) { checkbox.checked = !checkbox.checked; status.textContent = error.message; }
  finally { checkbox.disabled = false; }
});
