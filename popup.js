// Popup control panel JavaScript - v1.8.0

document.addEventListener('DOMContentLoaded', () => {
  updateModelStatus();
  loadConversationLog();
  
  document.getElementById('activate-tab').addEventListener('click', activateCurrentTab);
  document.getElementById('clear-log').addEventListener('click', clearLog);
  document.getElementById('export-log').addEventListener('click', exportLog);
  
  updateAutoSubmitStatus();

  setInterval(() => {
    updateModelStatus();
    loadConversationLog();
    updateAutoSubmitStatus();
  }, 2000);
});

async function activateCurrentTab() {
  const btn = document.getElementById('activate-tab');
  const originalText = btn.textContent;
  
  try {
    btn.textContent = 'Activating...';
    btn.disabled = true;
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab found');
    
    let platform = null;
    let scriptFile = null;
    
    if (tab.url.includes('claude.ai')) {
      platform = 'claude';
      scriptFile = 'content-claude.js';
    } else if (tab.url.includes('chatgpt.com') || tab.url.includes('chat.openai.com')) {
      platform = 'chatgpt';
      scriptFile = 'content-chatgpt.js';
    } else if (tab.url.includes('gemini.google.com')) {
      platform = 'gemini';
      scriptFile = 'content-gemini.js';
    } else if (tab.url.includes('grok.com')) {
      platform = 'grok';
      scriptFile = 'content-grok.js';
    } else if (tab.url.includes('chat.deepseek.com')) {
      platform = 'deepseek';
      scriptFile = 'content-deepseek.js';
    } else {
      throw new Error('Not an AI platform tab');
    }
    
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['ensemble-ui.css']
    });
    
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [scriptFile]
    });
    
    btn.textContent = '✓ Activated!';
    btn.style.background = '#00ff88';
    btn.style.color = '#000';
    
    setTimeout(() => updateModelStatus(), 500);
    
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.background = '';
      btn.style.color = '';
      btn.disabled = false;
    }, 2000);
    
  } catch (error) {
    console.error('Activation error:', error);
    btn.textContent = '✗ ' + error.message;
    btn.style.background = '#ff4444';
    
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.background = '';
      btn.disabled = false;
    }, 3000);
  }
}

function updateModelStatus() {
  chrome.runtime.sendMessage({ type: 'GET_ACTIVE_MODELS' }, (response) => {
    if (chrome.runtime.lastError || !response) return;
    
    const activeModels = response.models || [];
    
    ['claude', 'chatgpt', 'gemini', 'grok', 'deepseek'].forEach(model => {
      const card = document.querySelector(`[data-model="${model}"]`);
      if (!card) return;
      const status = card.querySelector('div:last-child');
      
      if (activeModels.includes(model)) {
        card.classList.add('active');
        status.textContent = '● Connected';
        status.style.color = '#00ff88';
      } else {
        card.classList.remove('active');
        status.textContent = '○ Not connected';
        status.style.color = '#999';
      }
    });

    const statusLine = document.getElementById('connection-summary');
    if (statusLine) {
      const n = activeModels.length;
      if (n === 5) {
        statusLine.textContent = 'All 5 models connected — ready to route!';
        statusLine.style.color = '#00ff88';
      } else if (n > 0) {
        statusLine.textContent = n + '/5 models connected';
        statusLine.style.color = '#ffc107';
      } else {
        statusLine.textContent = 'No models connected';
        statusLine.style.color = '#ff6666';
      }
    }
  });
}

function loadConversationLog() {
  chrome.runtime.sendMessage({ type: 'GET_CONVERSATION' }, (response) => {
    if (chrome.runtime.lastError || !response || !response.conversation) return;
    
    const conversation = response.conversation;
    const logContainer = document.getElementById('conversation-log');
    
    if (conversation.length === 0) {
      logContainer.innerHTML = '<div style="text-align:center;color:#666;padding:40px 20px;"><div style="font-size:32px;margin-bottom:12px;">🧠</div><div>No messages routed yet</div><div style="font-size:11px;margin-top:8px;opacity:0.7;">Send a message in any connected AI platform</div></div>';
      return;
    }
    
    const recentMessages = conversation.slice(-10);
    const platformColors = { claude: '#d4a574', chatgpt: '#74d4a5', gemini: '#7474d4', grok: '#d47474', deepseek: '#74b8d4' };
    logContainer.innerHTML = recentMessages.map(entry => {
      const color = platformColors[entry.platform] || '#999';
      return '<div class="log-entry"><div class="log-platform" style="color:' + color + '">' + entry.platform + '</div><div class="log-message">' + truncateMessage(entry.message, 150) + '</div></div>';
    }).join('');
    
    logContainer.scrollTop = logContainer.scrollHeight;
  });
}

function truncateMessage(message, maxLength) {
  if (message.length <= maxLength) return message;
  return message.substring(0, maxLength) + '...';
}

function clearLog() {
  if (confirm('Clear all conversation history?')) {
    chrome.runtime.sendMessage({ type: 'CLEAR_CONVERSATION' }, () => {
      loadConversationLog();
    });
  }
}

function updateAutoSubmitStatus() {
  chrome.storage.sync.get(['autoSubmit'], (result) => {
    const badge = document.getElementById('auto-submit-badge');
    if (!badge) return;
    const enabled = !!result?.autoSubmit;
    badge.textContent = enabled ? 'ON' : 'OFF';
    badge.style.background = enabled ? 'rgba(0,255,136,0.2)' : 'rgba(255,68,68,0.2)';
    badge.style.color = enabled ? '#00ff88' : '#ff6666';
  });
}

function exportLog() {
  chrome.runtime.sendMessage({ type: 'GET_CONVERSATION' }, (response) => {
    if (!response || !response.conversation) return;
    
    const jsonData = JSON.stringify(response.conversation, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ai-ensemble-conversation-' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(url);
    
    const btn = document.getElementById('export-log');
    const originalText = btn.textContent;
    btn.textContent = 'Exported!';
    btn.style.background = '#00ff88';
    btn.style.color = '#000';
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.background = '';
      btn.style.color = '';
    }, 2000);
  });
}
