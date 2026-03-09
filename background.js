// Background service worker for AI Ensemble (MV3) v17.7
// Port-based messaging + Alarms keepalive + Remote Config
// v17.7: Fixed GET_ACTIVE_MODELS to derive from active port connections

const PLATFORMS = { CLAUDE: 'claude', CHATGPT: 'chatgpt', GEMINI: 'gemini', GROK: 'grok', DEEPSEEK: 'deepseek' };

// ===============================
// KEEPALIVE: Alarms API
// ===============================
chrome.alarms.create('keepalive', { periodInMinutes: 0.3 });
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('keepalive', { periodInMinutes: 0.3 });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') {
    if (conversationLog.length > 100) {
      conversationLog = conversationLog.slice(-100);
      saveConversationLog();
    }
  }
});

// ===============================
// PORT-BASED MESSAGING
// ===============================
const activePorts = new Map();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ai-ensemble') return;
  const tabId = port.sender?.tab?.id;
  if (!tabId) return;
  console.log(`[AI Ensemble] Port connected: tab ${tabId}`);
  activePorts.set(tabId, port);

  port.onMessage.addListener((message) => {
    if (message.type === 'MODEL_RESPONSE') {
      handleModelResponse(message.data, port.sender);
    } else if (message.type === 'REGISTER_MODEL') {
      activeModels.add(message.platform);
      saveActiveModels();
    } else if (message.type === 'GET_CONFIG') {
      ensureConfigFresh(false).then(entry => {
        try { port.postMessage({ type: 'CONFIG_RESPONSE', config: entry.config, meta: { source: entry.source } }); } catch(e) {}
      });
    }
  });

  port.onDisconnect.addListener(() => {
    activePorts.delete(tabId);
  });
});

// ===============================
// Remote Config
// ===============================
const REMOTE_CONFIG_URL = null; // PATCHED: no phone-home (AskZch fork)
const CONFIG_CACHE_KEY = 'remoteConfigCache';
const DEFAULT_CONFIG_URL = chrome.runtime.getURL('default_config.json');
let configCache = null;

function compareSemVer(a, b) {
  const pa = String(a||'').split('.').map(x=>parseInt(x,10)||0);
  const pb = String(b||'').split('.').map(x=>parseInt(x,10)||0);
  for (let i = 0; i < Math.max(pa.length,pb.length); i++) {
    if ((pa[i]||0) < (pb[i]||0)) return -1;
    if ((pa[i]||0) > (pb[i]||0)) return 1;
  }
  return 0;
}
function getExtensionVersion() { try { return chrome.runtime.getManifest().version; } catch(_) { return '0.0.0'; } }

function validateConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return { ok: false };
  if (typeof cfg.configVersion !== 'number') return { ok: false };
  if (typeof cfg.ttlSeconds !== 'number' || cfg.ttlSeconds < 60) return { ok: false };
  if (typeof cfg.debounceMs !== 'number') return { ok: false };
  cfg.debounceMs = Math.min(8000, Math.max(800, Math.floor(cfg.debounceMs)));
  if (typeof cfg.killSwitch !== 'boolean') cfg.killSwitch = false;
  if (typeof cfg.minExtensionVersion !== 'string') cfg.minExtensionVersion = '0.0.0';
  if (!cfg.platforms || typeof cfg.platforms !== 'object') return { ok: false };
  for (const p of ['claude','chatgpt','gemini','grok','deepseek']) {
    const pc = cfg.platforms[p];
    if (!pc) continue; // tolerate missing platforms for forward-compat
    if (typeof pc.enabled !== 'boolean') pc.enabled = true;
    if (typeof pc.killSwitch !== 'boolean') pc.killSwitch = false;
  }
  return { ok: true };
}

async function loadFallbackConfig() {
  const res = await fetch(DEFAULT_CONFIG_URL, { cache: 'no-store' });
  const cfg = await res.json();
  if (!validateConfig(cfg).ok) throw new Error('Invalid fallback');
  return cfg;
}
async function fetchRemoteConfig() {
  // PATCHED: Remote config disabled. Always uses local default_config.json
  throw new Error('Remote config disabled - fully local fork');
}
function isExpired(entry) {
  if (!entry?.fetchedAt || !entry?.config) return true;
  return (Date.now() - entry.fetchedAt) > (entry.config.ttlSeconds || 21600) * 1000;
}
async function ensureConfigFresh(force = false) {
  if (!force && configCache && !isExpired(configCache)) return configCache;
  const stored = await chrome.storage.local.get([CONFIG_CACHE_KEY]);
  const entry = stored[CONFIG_CACHE_KEY] || null;
  if (!force && entry && !isExpired(entry)) { configCache = entry; return entry; }
  try {
    const remote = await fetchRemoteConfig();
    if (compareSemVer(getExtensionVersion(), remote.minExtensionVersion) < 0) throw new Error('Version gate');
    const e = { config: remote, fetchedAt: Date.now(), source: 'remote' };
    configCache = e; await chrome.storage.local.set({ [CONFIG_CACHE_KEY]: e }); return e;
  } catch (err) {
    const fallback = await loadFallbackConfig();
    const e = { config: fallback, fetchedAt: Date.now(), source: 'fallback' };
    configCache = e; await chrome.storage.local.set({ [CONFIG_CACHE_KEY]: e }); return e;
  }
}

// ===============================
// State
// ===============================
let conversationLog = [];
let activeModels = new Set();
chrome.storage.local.get(['activeModels','conversationLog',CONFIG_CACHE_KEY], async (r) => {
  if (r.activeModels) activeModels = new Set(r.activeModels);
  if (r.conversationLog) conversationLog = r.conversationLog;
  if (r[CONFIG_CACHE_KEY]) configCache = r[CONFIG_CACHE_KEY];
  try { await ensureConfigFresh(false); } catch(_) {}
});
function saveActiveModels() { chrome.storage.local.set({ activeModels: Array.from(activeModels) }); }
function saveConversationLog() { chrome.storage.local.set({ conversationLog }); }

// ===============================
// Routing
// ===============================
function handleModelResponse(data, sender) {
  const { platform, message, timestamp } = data;
  console.log(`[AI Ensemble] Received from ${platform} — routing`);
  conversationLog.push({ platform, message, timestamp: timestamp || Date.now(), tabId: sender?.tab?.id });
  saveConversationLog();

  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      if (tab.id === sender?.tab?.id) return;
      let target = null;
      if (tab.url?.includes('claude.ai')) target = 'claude';
      else if (tab.url?.includes('chatgpt.com') || tab.url?.includes('chat.openai.com')) target = 'chatgpt';
      else if (tab.url?.includes('gemini.google.com')) target = 'gemini';
      else if (tab.url?.includes('grok.com')) target = 'grok';
      else if (tab.url?.includes('chat.deepseek.com')) target = 'deepseek';
      if (target && target !== platform) {
        const payload = { type: 'POPULATE_INPUT', data: { message, sourcePlatform: platform } };
        const port = activePorts.get(tab.id);
        if (port) {
          try { port.postMessage(payload); console.log(`[AI Ensemble] → ${target} via port`); return; } catch(e) { activePorts.delete(tab.id); }
        }
        chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
      }
    });
  });
}

// Legacy sendMessage listener (popup + fallback)
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  (async () => {
    try {
      switch (req.type) {
        case 'MODEL_RESPONSE': handleModelResponse(req.data, sender); sendResponse({ success: true }); break;
        case 'GET_CONVERSATION': sendResponse({ conversation: conversationLog }); break;
        case 'CLEAR_CONVERSATION': conversationLog = []; sendResponse({ success: true }); break;
        case 'REGISTER_MODEL': activeModels.add(req.platform); saveActiveModels(); sendResponse({ success: true }); break;
        case 'GET_ACTIVE_MODELS': {
          const liveModels = new Set(activeModels);
          const tabs = await chrome.tabs.query({});
          const portTabIds = new Set(activePorts.keys());
          for (const tab of tabs) {
            if (!portTabIds.has(tab.id)) continue;
            if (tab.url?.includes('claude.ai')) liveModels.add('claude');
            else if (tab.url?.includes('chatgpt.com') || tab.url?.includes('chat.openai.com')) liveModels.add('chatgpt');
            else if (tab.url?.includes('gemini.google.com')) liveModels.add('gemini');
            else if (tab.url?.includes('grok.com')) liveModels.add('grok');
            else if (tab.url?.includes('chat.deepseek.com')) liveModels.add('deepseek');
          }
          sendResponse({ models: Array.from(liveModels) });
          break;
        }
        case 'GET_CONFIG': { const e = await ensureConfigFresh(false); sendResponse({ success:true, config:e.config, meta:{source:e.source,fetchedAt:e.fetchedAt,version:getExtensionVersion()} }); break; }
        case 'REFRESH_CONFIG': { const e = await ensureConfigFresh(true); sendResponse({ success:true, config:e.config, meta:{source:e.source,fetchedAt:e.fetchedAt,version:getExtensionVersion()} }); break; }
        case 'HEALTH_CHECK': sendResponse({ alive:true, activePorts:activePorts.size }); break;
        default: sendResponse({ success: false });
      }
    } catch(e) { sendResponse({ success:false, error:e?.message }); }
  })();
  return true;
});

// ===============================
// AUTO-SUBMIT TOGGLE (Alt+Shift+S)
// ===============================
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-auto-submit') {
    chrome.storage.sync.get(['autoSubmit'], (r) => {
      const newVal = !r.autoSubmit;
      chrome.storage.sync.set({ autoSubmit: newVal });
      // Notify all active content scripts
      activePorts.forEach((port) => {
        try { port.postMessage({ type: 'AUTO_SUBMIT_CHANGED', enabled: newVal }); } catch(e) {}
      });
      console.log(`[AI Ensemble] Auto-submit ${newVal ? 'ENABLED' : 'DISABLED'}`);
    });
  }
});

console.log('[AI Ensemble] Background v1.8.0 ready');
