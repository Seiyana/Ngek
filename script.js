const textarea        = document.getElementById('user-input');
const sendBtn         = document.getElementById('send-btn');
const messagesWrapper = document.getElementById('messages-wrapper');
const chatContainer   = document.getElementById('chat-container');
const themeToggle     = document.getElementById('theme-toggle');

// ── CONFIGURATION ─────────────────────────────────────────────────────────────
// ⚠️  Point this at Flask (port 5000).  Run:  ngrok http 5000
const NGROK_URL  = "https://inge-unidolized-kaylee.ngrok-free.dev"; // ← update each session
const MODEL_NAME = "qwen2.5:32b";

// ngrok-skip-browser-warning MUST be on every request or external devices
// receive an HTML interstitial page instead of JSON → Error 0 / Error 500.
const NGROK_HEADERS = {
    "Content-Type":                "application/json",
    "ngrok-skip-browser-warning":  "true",
};
// ─────────────────────────────────────────────────────────────────────────────

let isGenerating  = false;
let currentReader = null;

// ── Theme toggle ──────────────────────────────────────────────────────────────
themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    themeToggle.textContent = document.body.classList.contains('dark-mode')
        ? 'Light Mode' : 'Dark Mode';
});

// ── Auto-resize textarea ──────────────────────────────────────────────────────
const LINE_HEIGHT  = 24;
const MAX_LINES    = 6;
const MAX_HEIGHT   = LINE_HEIGHT * MAX_LINES;
const inputWrapper = document.querySelector('.input-wrapper');

textarea.addEventListener('input', function () {
    this.style.height = 'auto';
    const h = this.scrollHeight;
    this.style.height    = Math.min(h, MAX_HEIGHT) + 'px';
    this.style.overflowY = h > MAX_HEIGHT ? 'auto' : 'hidden';
    inputWrapper.classList.toggle('multiline', h > LINE_HEIGHT + 8);
});

textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!isGenerating) sendMessage();
    }
});

sendBtn.addEventListener('click', () => { if (!isGenerating) sendMessage(); });

const stopBtn = document.getElementById('stop-btn');
if (stopBtn) {
    stopBtn.addEventListener('click', () => { if (currentReader) currentReader.cancel(); });
}

document.querySelectorAll('.suggestions-row .suggestion-bubble').forEach(bubble => {
    bubble.addEventListener('click', () => {
        bubble.closest('.suggestions-row').remove();
        textarea.value = bubble.textContent;
        textarea.dispatchEvent(new Event('input'));
        sendMessage();
    });
});


// ═══════════════════════════════════════════════════════════════════════════════
//  MARKDOWN RENDERER
//  Converts the model's raw text (with ** bold **, * italic *, bullet lists,
//  numbered lists, and inline code) into safe HTML nodes.
//  No external library needed — pure DOM manipulation, no innerHTML on user text.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parse a single line of text and return a DocumentFragment with inline
 * formatting applied:  **bold**  *italic*  `code`
 */
function parseInline(text) {
    const frag = document.createDocumentFragment();

    // Regex that matches **bold**, *italic*, or `code` — in that priority order
    const pattern = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
    let last = 0, match;

    while ((match = pattern.exec(text)) !== null) {
        // Plain text before this match
        if (match.index > last) {
            frag.appendChild(document.createTextNode(text.slice(last, match.index)));
        }

        if (match[0].startsWith('**')) {
            const b = document.createElement('strong');
            b.textContent = match[2];
            frag.appendChild(b);
        } else if (match[0].startsWith('*')) {
            const em = document.createElement('em');
            em.textContent = match[3];
            frag.appendChild(em);
        } else {
            // backtick code
            const code = document.createElement('code');
            code.textContent = match[4];
            frag.appendChild(code);
        }

        last = match.index + match[0].length;
    }

    // Remaining plain text
    if (last < text.length) {
        frag.appendChild(document.createTextNode(text.slice(last)));
    }

    return frag;
}

/**
 * Convert a full bot response string into a DocumentFragment of block elements.
 * Handles:
 *   - Blank lines → paragraph breaks
 *   - Lines starting with "- " or "* " → <ul><li>
 *   - Lines starting with "N. " → <ol><li>
 *   - Lines starting with "### / ## / #" → <h3/h2/h1>
 *   - Everything else → <p>
 *   - Inline **bold**, *italic*, `code` within any block
 */
function renderMarkdown(rawText) {
    const container = document.createDocumentFragment();
    const lines     = rawText.split('\n');

    let currentUl   = null;   // active <ul> being built
    let currentOl   = null;   // active <ol> being built

    function flushLists() {
        if (currentUl) { container.appendChild(currentUl); currentUl = null; }
        if (currentOl) { container.appendChild(currentOl); currentOl = null; }
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trim = line.trim();

        // ── Empty line ────────────────────────────────────────────────────────
        if (!trim) {
            flushLists();
            continue;
        }

        // ── Headings ──────────────────────────────────────────────────────────
        const headingMatch = trim.match(/^(#{1,3})\s+(.+)/);
        if (headingMatch) {
            flushLists();
            const level = Math.min(headingMatch[1].length + 2, 6); // h3–h5 range
            const h = document.createElement(`h${level}`);
            h.appendChild(parseInline(headingMatch[2]));
            container.appendChild(h);
            continue;
        }

        // ── Unordered list item  (- text  or  * text) ────────────────────────
        const ulMatch = trim.match(/^[-*]\s+(.+)/);
        if (ulMatch) {
            flushLists();   // don't flush the UL we're building — just OL
            if (currentOl) { container.appendChild(currentOl); currentOl = null; }
            if (!currentUl) currentUl = document.createElement('ul');
            const li = document.createElement('li');
            li.appendChild(parseInline(ulMatch[1]));
            currentUl.appendChild(li);
            continue;
        }

        // ── Ordered list item  (1. text) ─────────────────────────────────────
        const olMatch = trim.match(/^\d+\.\s+(.+)/);
        if (olMatch) {
            if (currentUl) { container.appendChild(currentUl); currentUl = null; }
            if (!currentOl) currentOl = document.createElement('ol');
            const li = document.createElement('li');
            li.appendChild(parseInline(olMatch[1]));
            currentOl.appendChild(li);
            continue;
        }

        // ── Regular paragraph ─────────────────────────────────────────────────
        flushLists();
        const p = document.createElement('p');
        p.appendChild(parseInline(trim));
        container.appendChild(p);
    }

    flushLists(); // append any list still open at end of text
    return container;
}


// ═══════════════════════════════════════════════════════════════════════════════
//  SUGGESTIONS
// ═══════════════════════════════════════════════════════════════════════════════
async function fetchSuggestions(userPrompt, botResponse) {
    try {
        const res = await fetch(`${NGROK_URL}/api/suggest`, {
            method:  'POST',
            headers: NGROK_HEADERS,
            body:    JSON.stringify({ prompt: userPrompt, response: botResponse }),
        });
        if (!res.ok) return [];
        const data = await res.json();
        return data.suggestions || [];
    } catch (e) {
        console.error("[JILIAN] Suggestions error:", e);
        return [];
    }
}

function appendSuggestions(suggestions) {
    if (!suggestions.length) return;
    const existing = document.querySelector('.suggestions-row');
    if (existing) existing.remove();

    const row = document.createElement('div');
    row.className = 'suggestions-row';
    suggestions.forEach(text => {
        const btn = document.createElement('button');
        btn.className   = 'suggestion-bubble';
        btn.textContent = text;
        btn.addEventListener('click', () => {
            row.remove();
            textarea.value = text;
            textarea.dispatchEvent(new Event('input'));
            sendMessage();
        });
        row.appendChild(btn);
    });
    messagesWrapper.appendChild(row);
    scrollToBottom();
}


// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN SEND
// ═══════════════════════════════════════════════════════════════════════════════
async function sendMessage() {
    const text = textarea.value.trim();
    if (!text) return;

    isGenerating = true;
    sendBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.setProperty('display', 'flex', 'important');

    const existingSuggestions = document.querySelector('.suggestions-row');
    if (existingSuggestions) existingSuggestions.remove();

    appendUserMessage(text);
    textarea.value           = '';
    textarea.style.height    = '1.5rem';
    textarea.style.overflowY = 'hidden';
    inputWrapper.classList.remove('multiline');
    scrollToBottom();

    const botRow             = appendBotMessage();
    const contentDiv         = botRow.querySelector('.bot-content');
    let   rawText            = '';   // accumulates the full raw response
    let   fullBotResponse    = '';

    try {
        const response = await fetch(`${NGROK_URL}/api/generate`, {
            method:  'POST',
            headers: NGROK_HEADERS,
            body: JSON.stringify({ model: MODEL_NAME, prompt: text, stream: true }),
        });

        if (!response.ok) {
            const err  = new Error("HTTP_ERROR");
            err.status = response.status;
            throw err;
        }

        currentReader      = response.body.getReader();
        const decoder      = new TextDecoder();
        let   buffer       = '';

        while (true) {
            const { done, value } = await currentReader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const chunk = JSON.parse(line);
                    if (chunk.response) {
                        rawText          += chunk.response;
                        fullBotResponse  += chunk.response;

                        // Re-render the whole accumulated text on each chunk.
                        // This keeps markdown rendering consistent even mid-stream.
                        contentDiv.innerHTML = '';
                        contentDiv.appendChild(renderMarkdown(rawText));
                        scrollToBottom();
                    }
                } catch {
                    // malformed chunk — skip silently
                }
            }
        }

    } catch (error) {
        // ── Error code reference ──────────────────────────────────────────────
        //   0  → Network failure / tunnel offline / missing ngrok-skip header
        // 401  → CORS / OLLAMA_ORIGINS misconfigured
        // 403  → ngrok rate-limited or blocked
        // 404  → Wrong endpoint / stale ngrok URL
        // 408  → Request timed out
        // 500  → Flask or Ollama crash (check WSL terminal for traceback)
        // 503  → Flask/Ollama not running

        if (error.name === 'AbortError' || error.message?.includes('cancel')) {
            // Stop button — silent exit, keep whatever was rendered
        } else {
            let code = 500;
            if      (error.status === 401) code = 401;
            else if (error.status === 403) code = 403;
            else if (error.status === 404) code = 404;
            else if (error.status === 408) code = 408;
            else if (error.status === 503) code = 503;
            else if (error instanceof TypeError && error.message?.includes('fetch')) code = 0;

            console.error(`[JILIAN Error ${code}]`, error);
            contentDiv.innerHTML = '';
            const p = document.createElement('p');
            p.textContent = `Sorry, I couldn't generate a response. (Error ${code})`;
            contentDiv.appendChild(p);
        }

    } finally {
        isGenerating           = false;
        sendBtn.style.display  = 'flex';
        sendBtn.disabled       = false;
        if (stopBtn) stopBtn.style.setProperty('display', 'none', 'important');
        currentReader          = null;

        if (fullBotResponse) {
            const suggestions = await fetchSuggestions(text, fullBotResponse);
            appendSuggestions(suggestions);
        }
    }
}


// ═══════════════════════════════════════════════════════════════════════════════
//  DOM HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
function appendUserMessage(text) {
    const row      = document.createElement('div');
    row.className  = 'message-row user';
    const bubble   = document.createElement('div');
    bubble.className   = 'user-bubble';
    bubble.textContent = text;
    row.appendChild(bubble);
    messagesWrapper.appendChild(row);
}

/**
 * Append an empty bot message row and return it.
 * The caller writes into .bot-content directly.
 */
function appendBotMessage() {
    const row    = document.createElement('div');
    row.className = 'message-row bot';

    const avatar = document.createElement('div');
    avatar.className = 'bot-avatar';
    avatar.innerHTML = `<img src="assets/image.png" alt="Bot Picture">`;

    const content = document.createElement('div');
    content.className = 'bot-content';

    row.appendChild(avatar);
    row.appendChild(content);
    messagesWrapper.appendChild(row);
    return row;
}

function scrollToBottom() {
    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
}