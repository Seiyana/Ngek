const textarea = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const messagesWrapper = document.getElementById('messages-wrapper');
const chatContainer = document.getElementById('chat-container');
const themeToggle = document.getElementById('theme-toggle');

// --- OLLAMA CONFIGURATION ---
const NGROK_URL = "https://inge-unidolized-kaylee.ngrok-free.dev"; // PASTE YOUR NGROK URL HERE
const MODEL_NAME = "qwen2.5:32b";
let isGenerating = false;
let currentReader = null;

// Theme Toggle Logic
themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    themeToggle.textContent = document.body.classList.contains('dark-mode') ? 'Light Mode' : 'Dark Mode';
});

// Auto-resize textarea — grows freely up to 6 lines, scrollable after
const LINE_HEIGHT = 24; // px, matches CSS line-height: 1.5rem at 16px base
const MAX_LINES = 6;
const MAX_HEIGHT = LINE_HEIGHT * MAX_LINES;
const inputWrapper = document.querySelector('.input-wrapper');

textarea.addEventListener('input', function() {
    this.style.height = 'auto'; // reset so scrollHeight reflects true content
    const newHeight = this.scrollHeight;

    if (newHeight <= MAX_HEIGHT) {
        this.style.height = newHeight + 'px';
        this.style.overflowY = 'hidden';
    } else {
        this.style.height = MAX_HEIGHT + 'px';
        this.style.overflowY = 'auto';
    }

    // Align buttons to bottom when multiline, center when single line
    if (newHeight > LINE_HEIGHT + 8) {
        inputWrapper.classList.add('multiline');
    } else {
        inputWrapper.classList.remove('multiline');
    }
});

textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault(); 
        if (!isGenerating) sendMessage();
    }
});

sendBtn.addEventListener('click', () => {
    if (!isGenerating) sendMessage();
});

// Stop button
const stopBtn = document.getElementById('stop-btn');
if (stopBtn) {
    stopBtn.addEventListener('click', () => {
        if (currentReader) currentReader.cancel();
    });
}

document.querySelectorAll('.suggestions-row .suggestion-bubble').forEach(bubble => {
    bubble.addEventListener('click', () => {
        bubble.closest('.suggestions-row').remove();
        textarea.value = bubble.textContent;
        textarea.dispatchEvent(new Event('input'));
        sendMessage();
    });
});


async function fetchSuggestions(userPrompt, botResponse) {
    try {
        const res = await fetch(`${NGROK_URL}/api/suggest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: userPrompt, response: botResponse })
        });
        const data = await res.json();
        return data.suggestions || [];
    } catch (e) {
        console.error("Suggestions error:", e);
        return [];
    }
}

function appendSuggestions(suggestions) {
    if (!suggestions.length) return;

    // Remove any previous suggestion row
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
            textarea.dispatchEvent(new Event('input')); // trigger resize
            sendMessage();
        });
        row.appendChild(bubble);
    });

    messagesWrapper.appendChild(row);
    scrollToBottom();
}

async function sendMessage() {
    const text = textarea.value.trim();
    if (!text) return;

    isGenerating = true;
    sendBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.setProperty('display', 'flex', 'important');

    // Remove any existing suggestion row
    const existingSuggestions = document.querySelector('.suggestions-row');
    if (existingSuggestions) existingSuggestions.remove();

    appendUserMessage(text);
    textarea.value = '';
    textarea.style.height = '1.5rem';
    textarea.style.overflowY = 'hidden';
    inputWrapper.classList.remove('multiline');
    scrollToBottom();

    const botRow = appendBotMessage("");
    const responseTextElement = botRow.querySelector('p');
    let fullBotResponse = '';

    try {
        const response = await fetch(`${NGROK_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json',
             },
           
            body: JSON.stringify({
                model: MODEL_NAME,
                prompt: text,
                stream: true 
            })
        });

        if (!response.ok) {
            const err = new Error("HTTP_ERROR");
            err.status = response.status;
            throw err;
        }

        currentReader = response.body.getReader();
        const reader = currentReader;
        const decoder = new TextDecoder();
        let buffer = ''; 

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            
            buffer = lines.pop(); 

            for (const line of lines) {
                if (!line.trim()) continue;
                
                try {
                    const json = JSON.parse(line);
                    if (json.response) {
                        responseTextElement.textContent += json.response;
                        fullBotResponse += json.response;
                        scrollToBottom();
                    }
                } catch (e) {
                    console.error("Skipped malformed JSON chunk:", line);
                }
            }
        }
    } catch (error) {
        // --- Internal error code reference (never shown to user) ---
        // 401 → OLLAMA_ORIGINS not set / CORS rejection from Ollama
        // 403 → Ngrok or proxy blocked the request
        // 404 → Wrong endpoint path or ngrok URL is outdated
        // 408 → Request timed out — model too slow or server unresponsive
        // 500 → Ollama internal crash or model failed to load
        // 503 → Ollama not running or ngrok tunnel is down
        // 0   → Network-level failure — no internet, fetch blocked, tunnel offline

        let displayCode;

        if (error.name === 'AbortError' || error.message?.includes('cancel')) {
            // User intentionally stopped — not an error, exit silently
        } else {
            if (error.status === 401) displayCode = 401;
            else if (error.status === 403) displayCode = 403;
            else if (error.status === 404) displayCode = 404;
            else if (error.status === 408) displayCode = 408;
            else if (error.status === 500) displayCode = 500;
            else if (error.status === 503) displayCode = 503;
            else if (error instanceof TypeError && error.message?.includes('fetch')) displayCode = 0;
            else displayCode = 500;

            console.error(`[SeiBot Error ${displayCode}]`, error);
            responseTextElement.textContent = `Sorry, I couldn't generate a response. Error ${displayCode}`;
        }
    } finally {
        isGenerating = false;
        sendBtn.style.display = 'flex';
        sendBtn.disabled = false;
        if (stopBtn) stopBtn.style.setProperty('display', 'none', 'important');
        currentReader = null;

        if (fullBotResponse) {
            const suggestions = await fetchSuggestions(text, fullBotResponse);
            appendSuggestions(suggestions);
        }
    }
}

function appendUserMessage(text) {
    const row = document.createElement('div');
    row.className = 'message-row user';
    const bubble = document.createElement('div');
    bubble.className = 'user-bubble';
    bubble.textContent = text; 
    row.appendChild(bubble);
    messagesWrapper.appendChild(row);
}

function appendBotMessage(text) {
    const row = document.createElement('div');
    row.className = 'message-row bot';
    const avatar = document.createElement('div');
    avatar.className = 'bot-avatar';
    
    avatar.innerHTML = `<img src="assets/image.png" alt="Bot Picture">`; 
    
    const content = document.createElement('div');
    content.className = 'bot-content';
    const p = document.createElement('p');
    p.textContent = text;
    content.appendChild(p);

    row.appendChild(avatar);
    row.appendChild(content);
    messagesWrapper.appendChild(row);
    return row; 
}

function scrollToBottom() {
    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
}