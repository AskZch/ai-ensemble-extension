// Content script for Claude.ai — AI Ensemble v17.7
// Fixed: data-is-streaming is now primary assistant detection strategy
// Claude removed .prose classes and only uses user-message testids

if (window.__AI_ENSEMBLE_CLAUDE_V17__) {
  console.log('[AI Ensemble] Claude already injected; skipping.');
} else {
window.__AI_ENSEMBLE_CLAUDE_V17__ = true;

const PLATFORM = 'claude';
let DEBOUNCE_MS = 2200;
let CONFIG_PLATFORM = null;
let lastSentKey = null;
let pendingTimer = null;
let observer = null;

// ===============================
// PORT-BASED MESSAGING
// ===============================
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
      portReady = false;
      ensemblePort = null;
      setTimeout(connectPort, 800);
    });

    ensemblePort.onMessage.addListener((msg) => {
      if (msg.type === 'POPULATE_INPUT') {
        populateInputField(msg.data.message, msg.data.sourcePlatform);
      } else if (msg.type === 'CONFIG_RESPONSE' && msg.config) {
        applyConfig(msg.config);
      } else if (msg.type === 'AUTO_SUBMIT_CHANGED') {
        autoSubmitEnabled = msg.enabled;
      }
    });
  } catch(e) {
    portReady = false;
    ensemblePort = null;
    setTimeout(connectPort, 800);
  }
}

function safePost(message) {
  try {
    if (!chrome.runtime?.id) return false;
    if (portReady && ensemblePort) {
      ensemblePort.postMessage(message);
      return true;
    }
    chrome.runtime.sendMessage(message);
    return true;
  } catch(e) {
    console.warn('[AI Ensemble] Send failed:', e?.message);
    return false;
  }
}

connectPort();

// ===============================
// CONFIG
// ===============================
function applyConfig(config) {
  if (config?.debounceMs) DEBOUNCE_MS = config.debounceMs;
  if (config?.platforms?.claude) CONFIG_PLATFORM = config.platforms.claude;
}

setTimeout(() => {
  safePost({ type: 'GET_CONFIG' });
}, 500);

try {
  chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (resp) => {
    if (resp?.config) applyConfig(resp.config);
  });
} catch(e) {}

// Load auto-submit state
try { chrome.storage.sync.get(['autoSubmit'], (r) => { autoSubmitEnabled = !!r?.autoSubmit; }); } catch(e) {}

// ===============================
// HASH UTILITY
// ===============================
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

// ===============================
// TEXT EXTRACTION
// ===============================
function extractCleanText(element, excludeSelectors) {
  if (!element) return "";
  if (!excludeSelectors) {
    return (element.textContent || "").trim();
  }
  const clone = element.cloneNode(true);
  excludeSelectors.forEach(sel => {
    try { clone.querySelectorAll(sel).forEach(el => el.remove()); } catch(e) {}
  });
  clone.querySelectorAll('button, [role="button"], svg, [aria-hidden="true"]').forEach(el => el.remove());
  return (clone.textContent || "").trim();
}

// ===============================
// ASSISTANT ELEMENT DETECTION (v17.7 fix)
// ===============================
function getLatestAssistantElement() {
  const completed = document.querySelectorAll('[data-is-streaming="false"]');
  if (completed.length > 0) {
    const el = completed[completed.length - 1];
    const text = (el.textContent || '').trim();
    if (text.length >= 15) return el;
  }

  const streaming = document.querySelectorAll('[data-is-streaming="true"]');
  if (streaming.length > 0) {
    const el = streaming[streaming.length - 1];
    const text = (el.textContent || '').trim();
    if (text.length >= 15) return el;
  }

  const candidates = Array.from(document.querySelectorAll(
    '[data-testid$="-message"], [data-testid*="message"], div[class*="grid"][class*="message"]'
  ));
  for (let i = candidates.length - 1; i >= 0; i--) {
    const el = candidates[i];
    const tid = (el.getAttribute('data-testid') || '').toLowerCase();
    const cls = (el.className || '').toString().toLowerCase();
    if (tid === 'user-message' || tid.includes('user')) continue;
    if (cls.includes('font-user-message') || cls.includes('user-message')) continue;
    const content = findContentContainer(el);
    if (!content) continue;
    const text = (content.textContent || '').trim();
    if (text.length < 15) continue;
    return content;
  }

  const proseEls = Array.from(document.querySelectorAll(
    '.prose, [class*="prose"], [class*="font-claude"], [class*="markdown"]'
  ));
  for (let i = proseEls.length - 1; i >= 0; i--) {
    if (isInsideUserMessage(proseEls[i])) continue;
    const text = (proseEls[i].textContent || '').trim();
    if (text.length < 15) continue;
    return proseEls[i];
  }

  return null;
}

function findContentContainer(block) {
  return block.querySelector([
    '.prose', '[class*="prose"]', '[class*="font-claude"]',
    '[class*="claude-message"]', '[class*="markdown"]',
    '[data-testid*="content"]', 'pre'
  ].join(', '));
}

function isInsideUserMessage(el) {
  let p = el;
  for (let i = 0; i < 10 && p; i++) {
    const tid = (p.getAttribute?.('data-testid') || '').toLowerCase();
    const cls = (p.className || '').toString().toLowerCase();
    if (tid === 'user-message' || tid.includes('user-message')) return true;
    if (cls.includes('font-user-message')) return true;
    p = p.parentElement;
  }
  return false;
}

// ===============================
// GENERATION STATE CHECK (v17.7)
// ===============================
function isGenerating() {
  const streaming = document.querySelector('[data-is-streaming="true"]');
  if (streaming) return true;
  const stopBtn = document.querySelector('button[aria-label*="Stop"], button[title*="Stop"]');
  if (stopBtn) return true;
  return false;
}

// ===============================
// DEBOUNCE + FORWARD
// ===============================
function scheduleStableForward(text, delayMs, callback) {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    if (isGenerating()) {
      scheduleStableForward(text, delayMs, callback);
      return;
    }
    callback(text);
  }, delayMs);
}

let lastSentText = "";

function processLatestAssistantMessage(element) {
  const excludeSelectors = CONFIG_PLATFORM?.excludeSelectors || null;
  const messageText = extractCleanText(element, excludeSelectors);
  if (!messageText || messageText.length < 15) return;
  if (messageText === lastSentText) return;

  scheduleStableForward(messageText, DEBOUNCE_MS, (stableText) => {
    if (stableText === lastSentText) return;
    const key = simpleHash(stableText);
    if (key === lastSentKey) return;
    lastSentKey = key;
    lastSentText = stableText;
    console.log('[AI Ensemble] Sending Claude response to background');
    safePost({
      type: 'MODEL_RESPONSE',
      data: { platform: PLATFORM, message: stableText, timestamp: Date.now() }
    });
  });
}

// ===============================
// OBSERVER
// ===============================
function startResponseObserver() {
  console.log('[AI Ensemble] Starting Claude response observer');
  const targetNode = document.querySelector('main') || document.body;

  observer = new MutationObserver(() => {
    const el = getLatestAssistantElement();
    if (el) processLatestAssistantMessage(el);
  });

  observer.observe(targetNode, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['data-is-streaming', 'data-testid']
  });
  console.log('[AI Ensemble] Observer started');
}

// ===============================
// INPUT POPULATION (receiving from other platforms)
// ===============================
let lastReceivedHash = null;

function clickSendButton() {
  const btn = document.querySelector('button[aria-label="Send Message"]') ||
              document.querySelector('button[aria-label*="Send"]') ||
              document.querySelector('fieldset button:not([aria-label*="Stop"])');
  if (btn && !btn.disabled) { btn.click(); console.log('[AI Ensemble] Claude auto-submitted'); }
}

function populateInputField(message, sourcePlatform) {
  const inHash = simpleHash(message);
  if (inHash === lastReceivedHash) return;
  lastReceivedHash = inHash;

  console.log('[AI Ensemble] Attempting to populate Claude input field');
  
  const inputField = document.querySelector('.ProseMirror[contenteditable="true"]') ||
                     document.querySelector('[contenteditable="true"]') ||
                     document.querySelector('textarea') ||
                     document.querySelector('[role="textbox"]');

  if (!inputField) {
    console.error('[AI Ensemble] Could not find Claude input field');
    return;
  }

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
  console.log('[AI Ensemble] Claude input populated');

  if (autoSubmitEnabled) {
    setTimeout(() => clickSendButton(), 500);
  }
}

chrome.runtime.onMessage.addListener((request) => {
  if (request.type === 'POPULATE_INPUT') {
    populateInputField(request.data.message, request.data.sourcePlatform);
  }
});

// ===============================
// INIT
// ===============================
console.log('[AI Ensemble] Initializing Claude.ai integration (v17.7)');
setTimeout(startResponseObserver, 1000);

} // end injection guard
