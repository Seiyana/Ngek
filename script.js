const textarea = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const messagesWrapper = document.getElementById('messages-wrapper');
const chatContainer = document.getElementById('chat-container');
const themeToggle = document.getElementById('theme-toggle');

// ── CONFIGURATION ─────────────────────────────────────────────────────────────
// ⚠️  Point this at your Flask server (port 5000), NOT Ollama (11434).
//     In WSL, run:  ngrok http 5000   then paste the URL below.
const NGROK_URL  = "https://inge-unidolized-kaylee.ngrok-free.dev"; // ← update each session
const MODEL_NAME = "qwen2.5:32b";

// Required on every request to ngrok — without this, ngrok shows an HTML
// interstitial warning page to external browsers instead of forwarding the
// request, which causes Error 0 / Error 500 on all non-desktop devices.
const NGROK_HEADERS = {
    "Content-Type": "application/json",
    "ngrok-skip-browser-warning": "true",
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
    const newHeight = this.scrollHeight;
    if (newHeight <= MAX_HEIGHT) {
        this.style.height   = newHeight + 'px';
        this.style.overflowY = 'hidden';
    } else {
        this.style.height   = MAX_HEIGHT + 'px';
        this.style.overflowY = 'auto';
    }
    inputWrapper.classList.toggle('multiline', newHeight > LINE_HEIGHT + 8);
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


// ── Suggestions ───────────────────────────────────────────────────────────────
async function fetchSuggestions(userPrompt, botResponse) {
    try {
        const res = await fetch(`${NGROK_URL}/api/suggest`, {
            method:  'POST',
            headers: NGROK_HEADERS,           // ← ngrok header required here too
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
        const bubble = document.createElement('button');
        bubble.className = 'suggestion-bubble';
        bubble.textContent = text;
        bubble.addEventListener('click', () => {
            row.remove();
            textarea.value = text;
            textarea.dispatchEvent(new Event('input'));
            sendMessage();
        });
        row.appendChild(bubble);
    });
    messagesWrapper.appendChild(row);
    scrollToBottom();
}


// ── Main send logic ───────────────────────────────────────────────────────────
async function sendMessage() {
    const text = textarea.value.trim();
    if (!text) return;

    isGenerating = true;
    sendBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.setProperty('display', 'flex', 'important');

    const existingSuggestions = document.querySelector('.suggestions-row');
    if (existingSuggestions) existingSuggestions.remove();

    appendUserMessage(text);
    textarea.value = '';
    textarea.style.height   = '1.5rem';
    textarea.style.overflowY = 'hidden';
    inputWrapper.classList.remove('multiline');
    scrollToBottom();

    const botRow = appendBotMessage('');
    const responseTextElement = botRow.querySelector('p');
    let fullBotResponse = '';

    try {
        const response = await fetch(`${NGROK_URL}/api/generate`, {
            method:  'POST',
            headers: NGROK_HEADERS,           // ← ngrok-skip-browser-warning here
            body: JSON.stringify({
                model:  MODEL_NAME,
                prompt: text,                 // raw prompt — Flask injects knowledgebase
                stream: true,
            }),
        });

        // Non-2xx → throw with the status code attached
        if (!response.ok) {
            const err = new Error("HTTP_ERROR");
            err.status = response.status;
            throw err;
        }

        currentReader      = response.body.getReader();
        const reader       = currentReader;
        const decoder      = new TextDecoder();
        let   buffer       = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();           // keep incomplete trailing line

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const chunk = JSON.parse(line);
                    if (chunk.response) {
                        responseTextElement.textContent += chunk.response;
                        fullBotResponse               += chunk.response;
                        scrollToBottom();
                    }
                } catch {
                    console.warn("[JILIAN] Skipped malformed JSON chunk:", line);
                }
            }
        }

    } catch (error) {
        // ── Error code reference (internal) ──────────────────────────────────
        //   0  → Network failure / ngrok tunnel offline / no internet
        // 401  → CORS rejection or OLLAMA_ORIGINS misconfigured
        // 403  → ngrok blocked the request (IP / plan limit)
        // 404  → Wrong endpoint path or stale ngrok URL
        // 408  → Request timed out — model slow or server unresponsive
        // 500  → Flask or Ollama internal crash
        // 503  → Flask or Ollama not running / tunnel down
        //
        // Most common on external devices:
        //   • Error 0   → ngrok URL still points to Ollama:11434 instead of Flask:5000
        //                 OR the ngrok-skip-browser-warning header is missing
        //   • Error 500 → Flask threw an unhandled exception (check WSL terminal)

        if (error.name === 'AbortError' || error.message?.includes('cancel')) {
            // User pressed Stop — silent exit
        } else {
            let code;
            if      (error.status === 401) code = 401;
            else if (error.status === 403) code = 403;
            else if (error.status === 404) code = 404;
            else if (error.status === 408) code = 408;
            else if (error.status === 500) code = 500;
            else if (error.status === 503) code = 503;
            else if (error instanceof TypeError && error.message?.includes('fetch')) code = 0;
            else code = 500;

            console.error(`[JILIAN Error ${code}]`, error);
            responseTextElement.textContent =
                `Sorry, I couldn't generate a response. (Error ${code})`;
        }

    } finally {
        isGenerating      = false;
        sendBtn.style.display = 'flex';
        sendBtn.disabled  = false;
        if (stopBtn) stopBtn.style.setProperty('display', 'none', 'important');
        currentReader     = null;

        if (fullBotResponse) {
            const suggestions = await fetchSuggestions(text, fullBotResponse);
            appendSuggestions(suggestions);
        }
    }
}


// ── DOM helpers ───────────────────────────────────────────────────────────────
function appendUserMessage(text) {
    const row    = document.createElement('div');
    row.className = 'message-row user';
    const bubble  = document.createElement('div');
    bubble.className   = 'user-bubble';
    bubble.textContent = text;
    row.appendChild(bubble);
    messagesWrapper.appendChild(row);
}

function appendBotMessage(text) {
    const row     = document.createElement('div');
    row.className  = 'message-row bot';

    const avatar   = document.createElement('div');
    avatar.className = 'bot-avatar';
    avatar.innerHTML = `<img src="assets/image.png" alt="Bot Picture">`;

    const content  = document.createElement('div');
    content.className = 'bot-content';
    const p        = document.createElement('p');
    p.textContent  = text;
    content.appendChild(p);

    row.appendChild(avatar);
    row.appendChild(content);
    messagesWrapper.appendChild(row);
    return row;
}

function scrollToBottom() {
    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
}