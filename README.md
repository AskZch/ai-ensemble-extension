# AI Ensemble — Multi-Model AI Orchestration for Chrome

**A Chrome extension that routes responses between Claude, ChatGPT, and Gemini, enabling multi-model collaboration from your browser.**

Ask a question on one AI platform. The extension captures the response and forwards it to your other open AI tabs — giving you multiple perspectives, comparative reasoning, and collaborative AI workflows without copy-pasting.

---

## About This Project

AI Ensemble is a learning project. I'm an estate planning attorney in Missouri, not a software engineer. I built this because I wanted to see what happens when you make AI models talk to each other — and because no tool existed to do it without an API budget.

This extension went through 17+ versions over several months. Every version taught me something: about Chrome's Manifest V3 architecture, about MutationObservers, about the fragility of DOM selectors on platforms that update weekly, about the difference between "it works on my machine" and "it works."

I've taken it as far as my current skills can go. It works. It's not polished. A proper development team will build something better, and that's fine. This is here so you can learn from it, fork it, or just see what one non-developer built with AI assistance and stubbornness.

## What It Does

1. **Open multiple AI tabs** — Claude, ChatGPT, and/or Gemini
2. **Enable Ensemble Mode** — click the extension icon
3. **Ask your question** — on any platform
4. **Automatic routing** — the response gets forwarded to your other AI tabs
5. **Multi-model dialogue** — each AI responds to the previous AI's output

That's it. No accounts, no servers, no data collection.

## How It Works (Architecture)

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  content-claude  │     │ content-chatgpt  │     │ content-gemini   │
│  MutationObserver│     │ MutationObserver │     │ MutationObserver │
│  watches for     │     │  watches for     │     │  watches for     │
│  responses       │     │  responses       │     │  responses       │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │         Port-based messaging                  │
         │                       │                       │
         └───────────┬───────────┴───────────┬───────────┘
                     │                       │
              ┌──────┴───────┐               │
              │ background.js │◄──────────────┘
              │ Service Worker│
              │ Routes messages│
              │ between tabs  │
              └──────┬───────┘
                     │
              ┌──────┴───────┐
              │   popup.js    │
              │ Control panel │
              └──────────────┘
```

Each AI platform gets its own content script with a MutationObserver that watches for completed assistant responses. When one fires, the background service worker routes the text to the other platforms' input fields. A 2200ms debounce prevents routing partial (still-streaming) responses.

### Key Technical Details

- **Manifest V3** (Chrome's current extension standard)
- **Port-based messaging** between content scripts and the service worker
- **Alarms API keepalive** (0.3 min intervals) to prevent service worker termination
- **Remote config** hosted on GitHub Pages with bundled fallback — so DOM selectors can update without republishing the extension
- **Injection guards** prevent duplicate content script loading
- **Append mode** — never overwrites text you're already typing

### File Map

| File | Purpose |
|------|---------|
| `background.js` | Service worker — routing logic, config loading, port management |
| `content-claude.js` | Claude.ai response detection + input population |
| `content-chatgpt.js` | ChatGPT response detection + input population |
| `content-gemini.js` | Gemini response detection + input population |
| `popup.js` / `popup.html` | Extension control panel UI |
| `ensemble-ui.css` | Shared styling |
| `default_config.json` | Bundled fallback config for DOM selectors |
| `manifest.json` | Extension manifest (MV3) |

## What I Used It For

The most interesting output wasn't code — it was content.

I started with a throwaway prompt in Minimax-M2 (a free model through Ollama): "Write me a 1,000 word story with a framework." Then I ran that output through a cognitive lens I'd been developing — an analysis of how cognitive scarcity collapse reshapes human identity. Then I routed the whole thing through AI Ensemble for two cycles, letting Claude, ChatGPT, and Gemini build on each other's reasoning.

The product of that multi-model collaboration became the source material for a 30-chapter book outline. The first chapter is written. It's genuinely good — better than any single model produced alone.

That's the value proposition: not that any one AI is insufficient, but that the *collision* of different reasoning approaches produces something none of them reach independently.

## Known Limitations

- **DOM selector fragility** — AI platforms update their interfaces constantly. When they change their HTML structure, the content scripts break. The remote config system helps, but it's a maintenance treadmill.
- **Streaming detection** — Claude, ChatGPT, and Gemini each handle streaming differently. The debounce approach works but isn't elegant.
- **No conversation threading** — the extension routes individual responses, not full conversation context. Each AI sees only the last message, not the full dialogue history.
- **Platform login required** — you need active sessions on each platform. The extension can't authenticate for you.
- **Single-tab per platform** — having multiple Claude tabs open will cause confusion.

## What I Learned

**About Chrome extensions:** MV3 is a significant shift from MV2. Service workers terminate aggressively. The Alarms API keepalive pattern is essential but feels like a hack. Port-based messaging is more reliable than `chrome.runtime.sendMessage` for persistent connections.

**About DOM observation:** MutationObservers are powerful but fragile. Every platform structures its response containers differently, and those structures change without warning. Building a remote config system for selector updates was the most forward-thinking decision in the project.

**About building with AI:** I built this *using* the AI models it coordinates. There's a recursion there that still makes me smile. Claude helped debug the content scripts. ChatGPT helped with the popup UI. The tool was built by the tools it orchestrates.

**About scope:** I added a Gumroad licensing system in v17.8 before realizing the honest move was to release it free. Sometimes the best business decision is recognizing what something actually is — a proof of concept, not a product.

## Installation (Developer Mode)

1. Clone or download this repository
2. Open Chrome → `chrome://extensions/`
3. Enable "Developer mode" (top right toggle)
4. Click "Load unpacked"
5. Select the extension directory
6. Open tabs for Claude, ChatGPT, and/or Gemini
7. Click the AI Ensemble icon to enable routing

## The Published Version

AI Ensemble is also available on the [Chrome Web Store](https://chromewebstore.google.com/detail/ai-ensemble/lomphkghalmannpiophgdfjfdchfidim) as a free extension.

## License

MIT — do whatever you want with it. See [LICENSE](LICENSE).

## Author

**Patrick Nolan**
Estate Planning Attorney | Nolan Law Firm | Missouri

- [PatTalksLaw](https://www.youtube.com/@PatTalksLaw) — Legal education content
- [Practical Legal Tech](https://www.youtube.com/@PracticalLegalTech) — Technology for small law firms
- [nemolegal.com](https://nemolegal.com)

---

*This project represents one non-developer's journey through AI-assisted software development. It is released as-is, with no guarantees and no roadmap. If you build something better from it, that's the whole point.*
