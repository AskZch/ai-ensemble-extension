// Content script for DeepSeek (chat.deepseek.com) — AI Ensemble v1.8.0
// Port-based messaging + DeepSeek observer
// Follows same pattern as content-chatgpt.js

if (window.__AI_ENSEMBLE_DEEPSEEK_V17__) {
  console.log('[AI Ensemble] DeepSeek already injected; skipping.');
} else {
window.__AI_ENSEMBLE_DEEPSEEK_V17__ = true;

const PLATFORM = 'deepseek';
let DEBOUNCE_MS = 2200;
let CONFIG_PLATFORM = null;
let GENERATING_SELECTOR = null;
let LATEST_ASSISTANT_SELECTOR = null;
let ASSISTANT_TEXT_SELECTOR = null;
let lastSentKey = null;
let pendingTimer = null;
let observer = null;
let autoSubmitEnabled = false;

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
      else if (msg.type === 'AUTO_SUBMIT_CHANGED') autoSubmitEnabled = msg.enabled;
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

// bfcache: reconnect the port when the tab is restored from back/forward cache
window.addEventListener('pageshow', (e) => { if (e.persisted) { portReady = false; ensemblePort = null; connectPort(); } });
window.addEventListener('pagehide', () => { portReady = false; });

function applyConfig(config) {
  if (config?.debounceMs) DEBOUNCE_MS = config.debounceMs;
  if (config?.platforms?.deepseek) {
    CONFIG_PLATFORM = config.platforms.deepseek;
    GENERATING_SELECTOR = CONFIG_PLATFORM.generatingSelector || null;
    LATEST_ASSISTANT_SELECTOR = CONFIG_PLATFORM.latestAssistantSelector || null;
    ASSISTANT_TEXT_SELECTOR = CONFIG_PLATFORM.assistantTextSelector || null;
  }
}
setTimeout(() => { safePost({ type: 'GET_CONFIG' }); }, 500);
try { chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (r) => { if (r?.config) applyConfig(r.config); }); } catch(e) {}

// Load auto-submit state
try { chrome.storage.sync.get(['autoSubmit'], (r) => { autoSubmitEnabled = !!r?.autoSubmit; }); } catch(e) {}

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

function queryLatestAssistantElement() {
  try {
    if (LATEST_ASSISTANT_SELECTOR) {
      const nodes = document.querySelectorAll(LATEST_ASSISTANT_SELECTOR);
      if (nodes && nodes.length) return nodes[nodes.length - 1];
    }
  } catch(e) {}
  return null;
}

function getLatestAssistantElement() {
  // Try config-driven selector first
  const overrideEl = queryLatestAssistantElement();
  if (overrideEl) return overrideEl;

  // DeepSeek-specific fallbacks
  // DeepSeek uses .ds-markdown for rendered responses
  const dsMarkdown = document.querySelectorAll('.ds-markdown');
  if (dsMarkdown.length) return dsMarkdown[dsMarkdown.length - 1];

  // Try role-based selectors
  const roleMsgs = document.querySelectorAll('[data-role="assistant"], [class*="assistant-message"], [class*="bot-message"]');
  if (roleMsgs.length) return roleMsgs[roleMsgs.length - 1];

  // Generic markdown containers
  const markdownEls = document.querySelectorAll('[class*="markdown-body"], [class*="markdown"], [class*="prose"]');
  if (markdownEls.length) return markdownEls[markdownEls.length - 1];

  // Last resort
  const messages = document.querySelectorAll('[data-testid*="message"], [class*="message"]');
  if (messages.length === 0) return null;
  return messages[messages.length - 1];
}

function isStillGenerating() {
  if (GENERATING_SELECTOR) {
    try { return !!document.querySelector(GENERATING_SELECTOR); } catch(e) {}
  }
  return !!document.querySelector('[class*="loading"], [class*="generating"], [aria-busy="true"], button[aria-label*="Stop"], [class*="stop-generating"]');
}

function scheduleStableForward(text, delayMs, callback) {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    if (isStillGenerating()) { scheduleStableForward(text, delayMs, callback); return; }
    const el = getLatestAssistantElement();
    const excludeSelectors = CONFIG_PLATFORM?.excludeSelectors || null;
    const finalText = el ? extractCleanText(el, excludeSelectors) : text;
    if (finalText && finalText.length >= 3) callback(finalText);
  }, delayMs);
}

let lastSentText = "";

function processLatestAssistantMessage(element) {
  const excludeSelectors = CONFIG_PLATFORM?.excludeSelectors || null;
  const messageText = extractCleanText(element, excludeSelectors);
  if (!messageText || messageText.length < 3) return;
  if (messageText === lastSentText) return;
  scheduleStableForward(messageText, DEBOUNCE_MS, (stableText) => {
    if (stableText === lastSentText) return;
    const key = simpleHash(stableText);
    if (key === lastSentKey) return;
    lastSentKey = key; lastSentText = stableText;
    console.log('[AI Ensemble] Sending DeepSeek response to background');
    safePost({ type: 'MODEL_RESPONSE', data: { platform: PLATFORM, message: stableText, timestamp: Date.now() } });
  });
}

function startResponseObserver() {
  console.log('[AI Ensemble] Starting DeepSeek response observer');
  const targetNode = document.querySelector('main') || document.querySelector('#root') || document.body;
  observer = new MutationObserver(() => {
    const el = getLatestAssistantElement();
    if (el) processLatestAssistantMessage(el);
  });
  observer.observe(targetNode, { childList: true, subtree: true, characterData: true });
  console.log('[AI Ensemble] Observer started');
}

let lastReceivedHash = null;

function clickSendButton() {
  const btn = document.querySelector('button[aria-label*="Send"]') ||
              document.querySelector('button[aria-label*="send"]') ||
              document.querySelector('#chat-input-send') ||
              document.querySelector('button[data-testid*="send"]') ||
              document.querySelector('div[class*="chat-input"] button') ||
              document.querySelector('button[type="submit"]');
  if (btn && !btn.disabled) { btn.click(); console.log('[AI Ensemble] DeepSeek auto-submitted'); }
}

function populateInputField(message, sourcePlatform) {
  const inHash = simpleHash(message);
  if (inHash === lastReceivedHash) return;
  lastReceivedHash = inHash;
  console.log('[AI Ensemble] Attempting to populate DeepSeek input field');
  const inputField = document.querySelector('textarea#chat-input') ||
                     document.querySelector('textarea') ||
                     document.querySelector('[contenteditable="true"]') ||
                     document.querySelector('[role="textbox"]');
  if (!inputField) { console.error('[AI Ensemble] Could not find DeepSeek input field'); return; }

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
    const newVal = existing ? existing + '\n---\n' + newContent : newContent;
    // React-compatible value setter
    const nativeSet = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (nativeSet) {
      nativeSet.call(inputField, newVal);
    } else {
      inputField.value = newVal;
    }
    inputField.dispatchEvent(new Event('input', { bubbles: true }));
    inputField.dispatchEvent(new Event('change', { bubbles: true }));
  }
  console.log('[AI Ensemble] DeepSeek input populated');

  if (autoSubmitEnabled) {
    setTimeout(() => clickSendButton(), 500);
  }
}

chrome.runtime.onMessage.addListener((request) => {
  if (request.type === 'POPULATE_INPUT') populateInputField(request.data.message, request.data.sourcePlatform);
});

console.log('[AI Ensemble] Initializing DeepSeek integration (v1.8.0)');
setTimeout(startResponseObserver, 1000);

} // end injection guard
