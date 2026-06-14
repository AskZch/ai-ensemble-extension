// Content script for Gemini — AI Ensemble v1.8.1
// Updated: Neural Expressive redesign (May 2026) selectors
// model-response + message-content custom elements confirmed current

if (window.__AI_ENSEMBLE_GEMINI_V17__) {
  console.log('[AI Ensemble] Gemini already injected; skipping.');
} else {
window.__AI_ENSEMBLE_GEMINI_V17__ = true;

const PLATFORM = 'gemini';
let DEBOUNCE_MS = 2200;
let CONFIG_PLATFORM = null;
let GENERATING_SELECTOR = null;
let LATEST_ASSISTANT_SELECTOR = null;
let ASSISTANT_TEXT_SELECTOR = null;
let lastSentKey = null;
let pendingTimer = null;
let lastObservedText = "";
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

function applyConfig(config) {
  if (config?.debounceMs) DEBOUNCE_MS = config.debounceMs;
  if (config?.platforms?.gemini) {
    CONFIG_PLATFORM = config.platforms.gemini;
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

  // Primary: model-response custom element (confirmed current 2026)
  const modelResponses = document.querySelectorAll('model-response');
  if (modelResponses.length) {
    const lastResponse = modelResponses[modelResponses.length - 1];
    // Try to get message-content inside it for cleaner text
    const msgContent = lastResponse.querySelector('message-content');
    return msgContent || lastResponse;
  }

  // Fallback: message-content custom elements directly
  const msgContents = document.querySelectorAll('message-content');
  if (msgContents.length) return msgContents[msgContents.length - 1];

  // Fallback: data-turn-role (older versions)
  const modelTurns = document.querySelectorAll('[data-turn-role="model"], .model-response-text');
  if (modelTurns.length) return modelTurns[modelTurns.length - 1];

  // Fallback: response containers, prose/markdown
  const containers = document.querySelectorAll('.message-content, [class*="response-container"]');
  if (containers.length) return containers[containers.length - 1];

  const messages = document.querySelectorAll('[data-testid*="message"], div[class*="prose"], div[class*="markdown"]');
  if (messages.length === 0) return null;
  return messages[messages.length - 1];
}

function isStillGenerating() {
  if (GENERATING_SELECTOR) {
    try { return !!document.querySelector(GENERATING_SELECTOR); } catch(e) {}
  }
  return !!document.querySelector('.loading-indicator, [class*="loading"], [class*="generating"], [aria-busy="true"], button[aria-label*="Stop"]');
}

function scheduleStableForward(text, delayMs, callback) {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    if (isStillGenerating()) { scheduleStableForward(text, delayMs, callback); return; }
    const el = getLatestAssistantElement();
    const excludeSelectors = CONFIG_PLATFORM?.excludeSelectors || null;
    const finalText = el ? extractCleanText(el, excludeSelectors) : text;
    if (finalText && finalText.length >= 15) callback(finalText);
  }, delayMs);
}

function processLatestAssistantMessage(element) {
  const excludeSelectors = CONFIG_PLATFORM?.excludeSelectors || null;
  const messageText = extractCleanText(element, excludeSelectors);
  if (!messageText || messageText.length < 15) return;
  if (messageText === lastObservedText) return;
  lastObservedText = messageText;
  scheduleStableForward(messageText, DEBOUNCE_MS, (stableText) => {
    const key = simpleHash(stableText);
    if (key === lastSentKey) return;
    lastSentKey = key;
    console.log('[AI Ensemble] Sending Gemini response to background');
    safePost({ type: 'MODEL_RESPONSE', data: { platform: PLATFORM, message: stableText, timestamp: Date.now() } });
  });
}

function startResponseObserver() {
  console.log('[AI Ensemble] Starting Gemini response observer');
  const targetNode = document.querySelector('#chat-history') ||
                     document.querySelector('[data-test-id="chat-history-container"]') ||
                     document.querySelector('main') ||
                     document.body;
  observer = new MutationObserver(() => {
    const el = getLatestAssistantElement();
    if (el) processLatestAssistantMessage(el);
  });
  observer.observe(targetNode, { childList: true, subtree: true, characterData: true });
  console.log('[AI Ensemble] Observer started on', targetNode.tagName || 'body');
}

let lastReceivedHash = null;

function clickSendButton() {
  const btn = document.querySelector('button[aria-label="Send message"]') ||
              document.querySelector('button[aria-label*="Send"]') ||
              document.querySelector('.send-button') ||
              document.querySelector('button[mattooltip*="Send"]') ||
              document.querySelector('button[data-test-id*="send"]');
  if (btn && !btn.disabled) { btn.click(); console.log('[AI Ensemble] Gemini auto-submitted'); }
}

function populateInputField(message, sourcePlatform) {
  const inHash = simpleHash(message);
  if (inHash === lastReceivedHash) return;
  lastReceivedHash = inHash;
  console.log('[AI Ensemble] Attempting to populate Gemini input field');

  // Gemini input field selectors — updated for 2026 Neural Expressive redesign
  const inputField = document.querySelector('rich-textarea [contenteditable="true"]') ||
                     document.querySelector('.ql-editor[contenteditable="true"]') ||
                     document.querySelector('input-area-v2 [contenteditable="true"]') ||
                     document.querySelector('[contenteditable="true"]') ||
                     document.querySelector('textarea') ||
                     document.querySelector('[role="textbox"]');
  if (!inputField) { console.error('[AI Ensemble] Could not find Gemini input field'); return; }

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
  console.log('[AI Ensemble] Gemini input populated');

  if (autoSubmitEnabled) {
    setTimeout(() => clickSendButton(), 500);
  }
}

chrome.runtime.onMessage.addListener((request) => {
  if (request.type === 'POPULATE_INPUT') populateInputField(request.data.message, request.data.sourcePlatform);
});

console.log('[AI Ensemble] Initializing Gemini integration (v1.8.1)');
setTimeout(startResponseObserver, 1000);

} // end injection guard
