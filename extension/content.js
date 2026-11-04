(() => {
  const EDITOR = '.ql-editor[contenteditable="true"]';
  const ROOT = '[data-qa="message_input_container"], .p-message_input';
  const THREAD = '.p-thread_view, .p-thread_flexpane, .p-threads_view__thread, [data-qa="thread_view"], [data-qa="thread_flexpane"]';
  const MESSAGE = '[data-qa="message-text"], .c-message_kit__text';
  const SEND = '[data-qa="texty_send_button"]';
  const composers = new Map();
  const rendered = new Map();
  let route = '', scheduled = false, encryptionEnabled = true;
  function workspace() { return location.pathname.match(/^\/client\/(T[A-Z0-9]+)(?:\/|$)/)?.[1] || ''; }
  function currentScope() {
    const match = location.pathname.match(/^\/client\/(T[A-Z0-9]+)\/([CDG][A-Z0-9]+)(?:\/|$)/);
    return match ? `${match[1]}/${match[2]}` : '';
  }
  function composerRoot(editor) {
    // Thread composers need not have the main channel's p-message_input wrapper.
    for (let node = editor.parentElement; node && node !== document.body; node = node.parentElement) {
      if (node.querySelectorAll(EDITOR).length !== 1) return null;
      if (node.querySelector(SEND)) return node;
    }
    return null;
  }
  function context(node) {
    let pane = node.closest(THREAD);
    if (!pane) {
      // Discover a thread pane by its permalink when Slack changes its classes.
      for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (parent.querySelectorAll(EDITOR).length > 1 || parent.querySelector(ROOT)) break;
        if (parent.querySelector('a[href*="thread_ts="]')) { pane = parent; break; }
      }
    }
    if (pane) {
      const targets = new Map();
      for (const link of pane.querySelectorAll('a[href*="/archives/"]')) {
        let url;
        try { url = new URL(link.getAttribute('href'), location.href); } catch { continue; }
        const channel = url.pathname.match(/^\/archives\/([CDG][A-Z0-9]+)\//)?.[1];
        const thread = url.searchParams.get('thread_ts');
        if (channel && /^\d+\.\d+$/.test(thread || '')) {
          targets.set(`${channel}/${thread}`, {scope:`${workspace()}/${channel}`,thread,pane});
        }
      }
      if (!targets.size) {
        const link = pane.querySelector('a[href*="/archives/"][href*="/p"]');
        const match = link?.getAttribute('href').match(/\/archives\/([CDG][A-Z0-9]+)\/p(\d{10})(\d{6})(?:[?#]|$)/);
        if (match) targets.set('root', {scope:`${workspace()}/${match[1]}`,thread:`${match[2]}.${match[3]}`,pane});
      }
      // An unidentifiable or mixed thread pane must never fall back to the main channel.
      return workspace() && targets.size === 1 ? [...targets.values()][0] : null;
    }
    if (node.matches(EDITOR) && !node.closest(ROOT)) return null;
    const scope = currentScope();
    return scope ? {scope,thread:'',pane:null} : null;
  }
  function sameContext(item) {
    const next = context(item.editor);
    return !next ? !item.scope : next.scope === item.scope && next.thread === item.thread && next.pane === item.pane;
  }
  async function request(message) {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) throw new Error(result?.error || '擴充套件無回應');
    return result;
  }
  function restoreComposers() {
    for (const {root,frame} of composers.values()) { root.classList.remove('slackenc-hidden'); frame.remove(); }
    for (const root of document.querySelectorAll('[data-slackenc-composer]')) {
      root.classList.remove('slackenc-hidden', 'slackenc-sending'); root.removeAttribute('data-slackenc-composer');
    }
    for (const frame of document.querySelectorAll('.slackenc-frame')) frame.remove();
    composers.clear();
  }
  function restoreMessages() {
    for (const [node, record] of rendered) { node.classList.remove('slackenc-hidden'); record.view.remove(); }
    rendered.clear();
  }
  function installComposers() {
    for (const [id,item] of composers) {
      if (!item.root.isConnected || !item.editor.isConnected || !sameContext(item)) { item.root.classList.remove('slackenc-hidden'); item.frame.remove(); composers.delete(id); }
    }
    if (!workspace() || !encryptionEnabled) { restoreComposers(); return; }
    document.querySelectorAll(EDITOR).forEach(editor => {
      const root = composerRoot(editor);
      if (!root || [...composers.values()].some(item => item.root === root)) return;
      const target = context(editor);
      const id = crypto.randomUUID();
      const frame = document.createElement('iframe');
      frame.className = 'slackenc-frame'; frame.title = target?.thread ? 'Slack Cipher 對話串安全輸入框' : 'Slack Cipher 安全輸入框';
      frame.src = chrome.runtime.getURL('composer.html') + '#' + new URLSearchParams({scope:target?.scope || '', thread:target?.thread || '', composer:id});
      // Preserve any pre-existing native draft rather than silently replacing it.
      if (editor.textContent.trim()) {
        frame.title += '（原生草稿仍保留，請先處理草稿）';
      }
      root.setAttribute('data-slackenc-composer', id);
      root.classList.add('slackenc-hidden'); root.after(frame);
      composers.set(id, {root,editor,frame,scope:target?.scope || '',thread:target?.thread || '',pane:target?.pane || null,busy:false});
    });
  }
  function readMessages() {
    for (const [node,record] of rendered) {
      if (!node.isConnected || node.textContent !== record.source || record.scope !== context(node)?.scope) {
        node.classList.remove('slackenc-hidden'); record.view.remove(); rendered.delete(node);
      }
    }
    document.querySelectorAll(MESSAGE).forEach(node => {
      if (rendered.has(node) || node.closest(ROOT) || node.closest(EDITOR) || node.parentElement?.closest(MESSAGE)) return;
      const source = node.textContent;
      const wire = source.trim();
      if (!/^⚿:/.test(wire)) return;
      const view = document.createElement('div'); view.className = 'slackenc-plaintext'; view.textContent = '🔒 解密中…';
      const target = context(node);
      if (!target) return;
      const record = {source,view,scope:target.scope}; rendered.set(node,record);
      node.classList.add('slackenc-hidden'); node.after(view);
      request({type:'decrypt',text:wire,scope:target.scope}).then(result => {
        if (rendered.get(node) !== record || node.textContent !== source || context(node)?.scope !== record.scope) return;
        view.textContent = result.text; view.title = '已在本機解密';
      }).catch(error => {
        if (rendered.get(node) !== record) return;
        // Keep the ciphertext available when a key is missing or verification fails.
        node.classList.remove('slackenc-hidden'); view.className = 'slackenc-error'; view.textContent = `🔒 ${error.message}`;
      });
    });
  }
  function scan() {
    scheduled = false;
    const nextRoute = location.pathname;
    if (route !== nextRoute) { restoreComposers(); restoreMessages(); route = nextRoute; }
    installComposers();
    if (workspace()) readMessages();
  }
  function schedule() { if (!scheduled) { scheduled = true; setTimeout(scan, 100); } }
  // Guard hidden native composers against accidental plaintext input or submission.
  for (const type of ['keydown','beforeinput','paste','drop','click','submit']) {
    document.addEventListener(type, event => {
      if (!event.isTrusted || !encryptionEnabled || !workspace()) return;
      const editor = event.target instanceof Element && event.target.closest(EDITOR);
      const root = editor ? composerRoot(editor) : [...composers.values()].find(item => item.root.contains(event.target))?.root;
      if (root) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === 'settings-changed') {
      encryptionEnabled = message.encryptionEnabled !== false;
      if (!encryptionEnabled) restoreComposers();
      restoreMessages(); schedule(); respond({ok:true}); return;
    }
    if (message.type !== 'deliver' || sender.id !== chrome.runtime.id) return;
    const item = composers.get(message.composer);
    async function deliver() {
      if (!encryptionEnabled || !item || item.busy || item.scope !== message.scope || !sameContext(item) || !item.editor.isConnected) throw new Error('頻道或輸入框已變更，草稿已保留');
      if (!/^⚿:[A-Za-z0-9]{12}:~[\u4e00-\u8dff]+[0-9a-d]$/.test(message.text)) throw new Error('拒絕傳送非密文');
      if (item.editor.textContent.trim()) throw new Error('Slack 原生輸入框有草稿或待確認密文。請暫時停用擴充套件並處理草稿後重試');
      item.busy = true;
      try {
        item.root.classList.add('slackenc-sending');
        item.editor.focus();
        const selection = window.getSelection(), range = document.createRange();
        range.selectNodeContents(item.editor); selection.removeAllRanges(); selection.addRange(range);
        // execCommand updates Slack's contenteditable model and emits its input event.
        if (!document.execCommand('insertText', false, message.text)) throw new Error('無法填入 Slack 輸入框');
        await new Promise(resolve => setTimeout(resolve, 100));
        if (!encryptionEnabled || !sameContext(item) || !item.editor.isConnected || item.editor.textContent.trim() !== message.text) throw new Error('Slack 輸入內容不符，已停止送出');
        const button = item.root.querySelector(SEND);
        if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') throw new Error('找不到可用的 Slack 送出按鈕');
        button.click();
        // A click is not an acknowledgement: wait for Slack to consume the draft.
        for (let i = 0; i < 40; i++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          if (!sameContext(item) || !item.editor.isConnected) throw new Error('頁面已切換，請確認是否送達，避免重複送出');
          if (!item.editor.textContent.trim()) return;
        }
        throw new Error('Slack 尚未清空密文草稿，請確認是否送達；不會自動重送');
      } finally { item.root.classList.remove('slackenc-sending'); item.frame.focus(); item.busy = false; }
    }
    deliver().then(() => respond({ok:true}), error => respond({ok:false,error:error.message}));
    return true;
  });
  async function refresh() {
    try { const state = await request({type:'state'}); encryptionEnabled = state.encryptionEnabled !== false; restoreMessages(); schedule(); }
    catch { /* Existing protected composers stay blocked if the worker is unavailable. */ }
  }
  new MutationObserver(schedule).observe(document.documentElement, {childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['href']});
  window.addEventListener('popstate', schedule);
  setInterval(schedule, 1000);
  schedule();
  refresh();
})();
