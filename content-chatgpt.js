// Content script for ChatGPT — AI Ensemble v17.7
// Fixed: port-based messaging eliminates context invalidation
// v17.7: Input population now appends instead of replacing

if (window.__AI_ENSEMBLE_CHATGPT_V17__) {
  console.log('[AI Ensemble] ChatGPT already injected; skipping.');
} else {
window.__AI_ENSEMBLE_CHATGPT_V17__ = true;

const PLATFORM = 'chatgpt';
let DEBOUNCE_MS = 2200;
let CONFIG_PLATFORM = null;
let lastSentKey = null;
let pendingTimer = null;
let observer = null;

let ensemblePort = null;
let portReady = false;

function connectPort() {
  try {
    if (!chrome.runtime?.id) return;
    ensemblePort = chrome.runtime.connect({ name: 'ai-ensemble' });
    portReady = true;
    console.log('[AI Ensemble] Port connected');
    ensemblePort.onDisconnect.addListener(() => {
      portReady = false; ensemblePort = null; setTimeout(connectPort, 800);
    });
    ensemblePort.onMessage.addListener((msg) => {
      if (msg.type === 'POPULATE_INPUT') populateInputField(msg.data.message, msg.data.sourcePlatform);
      else if (msg.type === 'CONFIG_RESPONSE' && msg.config) applyConfig(msg.config);
    });
  } catch(e) { portReady = false; ensemblePort = null; setTimeout(connectPort, 800); }
}

function safePost(message) {
  try {
    if (!chrome.runtime?.id) return false;
    if (portReady && ensemblePort) { ensemblePort.postMessage(message); return true; }
    chrome.runtime.sendMessage(message); return true;
  } catch(e) { console.warn('[AI Ensemble] Send failed:', e?.message); return false; }
}

connectPort();

function applyConfig(config) {
  if (config?.debounceMs) DEBOUNCE_MS = config.debounceMs;
  if (config?.platforms?.chatgpt) CONFIG_PLATFORM = config.platforms.chatgpt;
}
setTimeout(() => { safePost({ type: 'GET_CONFIG' }); }, 500);
try { chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (r) => { if (r?.config) applyConfig(r.config); }); } catch(e) {}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash |= 0; }
  return String(hash);
}

function extractCleanText(element, excludeSelectors) {
  if (!element) return "";
  if (!excludeSelectors) return (element.textContent || "").trim();
  const clone = element.cloneNode(true);
  excludeSelectors.forEach(sel => { try { clone.querySelectorAll(sel).forEach(el => el.remove()); } catch(e) {} });
  clone.querySelectorAll('button, [role="button"], svg').forEach(el => el.remove());
  return (clone.textContent || "").trim();
}

function getLatestAssistantElement() {
  const assistantMsgs = document.querySelectorAll('[data-message-author-role="assistant"]');
  if (assistantMsgs.length) return assistantMsgs[assistantMsgs.length - 1];
  const allMsgs = document.querySelectorAll('[data-message-id]');
  for (let i = allMsgs.length - 1; i >= 0; i--) {
    if (allMsgs[i].getAttribute('data-message-author-role') !== 'user') return allMsgs[i];
  }
  const classMsgs = document.querySelectorAll('[class*="agent-turn"], [class*="assistant"]');
  if (classMsgs.length) return classMsgs[classMsgs.length - 1];
  return null;
}

function scheduleStableForward(text, delayMs, callback) {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => { callback(text); }, delayMs);
}

let lastSentText = "";

function processLatestAssistantMessage(element) {
  const excludeSelectors = CONFIG_PLATFORM?.excludeSelectors || null;
  const messageText = extractCleanText(element, excludeSelectors);
  if (!messageText || messageText.length < 15) return;
  if (messageText === lastSentText) return;
  const dedupeSalt = element?.getAttribute?.('data-message-id') || '';
  scheduleStableForward(messageText, DEBOUNCE_MS, (stableText) => {
    if (stableText === lastSentText) return;
    const key = simpleHash(stableText + dedupeSalt);
    if (key === lastSentKey) return;
    lastSentKey = key; lastSentText = stableText;
    console.log('[AI Ensemble] Sending ChatGPT response to background');
    safePost({ type: 'MODEL_RESPONSE', data: { platform: PLATFORM, message: stableText, timestamp: Date.now() } });
  });
}

function startResponseObserver() {
  console.log('[AI Ensemble] Starting ChatGPT response observer');
  const targetNode = document.querySelector('main') || document.body;
  observer = new MutationObserver(() => {
    const el = getLatestAssistantElement();
    if (el) processLatestAssistantMessage(el);
  });
  observer.observe(targetNode, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['data-message-author-role', 'data-message-id']
  });
  console.log('[AI Ensemble] Observer started');
}

let lastReceivedHash = null;

function populateInputField(message, sourcePlatform) {
  const inHash = simpleHash(message);
  if (inHash === lastReceivedHash) return;
  lastReceivedHash = inHash;
  console.log('[AI Ensemble] Attempting to populate ChatGPT input field');
  const inputField = document.querySelector('#prompt-textarea') ||
                     document.querySelector('[contenteditable="true"]') ||
                     document.querySelector('textarea') ||
                     document.querySelector('[role="textbox"]');
  if (!inputField) { console.error('[AI Ensemble] Could not find ChatGPT input field'); return; }

  const header = `[From ${sourcePlatform.toUpperCase()}]`;
  const newContent = `${header}\n${message}`;

  if (inputField.getAttribute('contenteditable') === 'true') {
    const p = document.createElement('p');
    p.textContent = newContent;
    if (inputField.textContent.trim().length > 0) {
      const sep = document.createElement('p');
      sep.textContent = '---';
      inputField.appendChild(sep);
    }
    inputField.appendChild(p);
    inputField.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    const existing = (inputField.value || '').trim();
    inputField.value = existing ? existing + '\n---\n' + newContent : newContent;
    inputField.dispatchEvent(new Event('input', { bubbles: true }));
  }
  console.log('[AI Ensemble] ChatGPT input populated');
}

chrome.runtime.onMessage.addListener((request) => {
  if (request.type === 'POPULATE_INPUT') populateInputField(request.data.message, request.data.sourcePlatform);
});

console.log('[AI Ensemble] Initializing ChatGPT integration (v17.7)');
setTimeout(startResponseObserver, 1000);

} // end injection guard
