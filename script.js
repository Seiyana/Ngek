const textarea = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const messagesWrapper = document.getElementById('messages-wrapper');
const chatContainer = document.getElementById('chat-container');
const themeToggle = document.getElementById('theme-toggle');

// --- OLLAMA CONFIGURATION ---
const NGROK_URL = "http://localhost:5000"; // PASTE YOUR NGROK URL HERE
const MODEL_NAME = "qwen2.5:32b";
let isGenerating = false; 
let currentReader = null;

// Theme Toggle Logic
themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    themeToggle.textContent = document.body.classList.contains('dark-mode') ? 'Light Mode' : 'Dark Mode';
});

// Auto-resize textarea
textarea.addEventListener('input', function() {
    this.style.height = '24px'; 
    this.style.height = Math.min(this.scrollHeight, 200) + 'px'; 
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

function appendSuggestions(suggestions, originalPrompt) {
    if (!suggestions.length) return;

    const row = document.createElement('div');
    row.className = 'suggestions-row';

    suggestions.forEach(text => {
        const bubble = document.createElement('button');
        bubble.className = 'suggestion-bubble';
        bubble.textContent = text;
        bubble.addEventListener('click', () => {
            // Remove suggestions after clicking
            row.remove();
            // Set the textarea to the suggestion and send
            textarea.value = text;
            textarea.style.height = '24px';
            textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
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
    stopBtn.style.setProperty('display', 'flex', 'important');

    appendUserMessage(text);
    textarea.value = '';
    textarea.style.height = '24px';
    scrollToBottom();

    const botRow = appendBotMessage("");
    const responseTextElement = botRow.querySelector('p');

    try {
        const response = await fetch(`${NGROK_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: MODEL_NAME,
                prompt: text,
                stream: true
            })
        });

        if (!response.ok) throw new Error("Network response was not ok");

        currentReader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await currentReader.read();
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
                        scrollToBottom();
                    }
                } catch (e) {
                    console.error("Skipped malformed JSON chunk:", line);
                }
            }
        }
    } catch (error) {
        if (error.name === 'AbortError' || error.message.includes('cancel')) {
            // Stream was cancelled by user, do nothing
        } else {
            responseTextElement.textContent = "Error: Could not connect to Ollama.";
            console.error(error);
        }
    } finally {
        isGenerating = false;
        sendBtn.style.display = 'flex';
        stopBtn.style.setProperty('display', 'none', 'important');
        sendBtn.disabled = false;
        
         const suggestions = await fetchSuggestions(text, responseTextElement.textContent);
    appendSuggestions(suggestions, text);
    }
}

// Add stop button logic
const stopBtn = document.getElementById('stop-btn');
stopBtn.addEventListener('click', () => {
    if (currentReader) {
        currentReader.cancel();
    }
});

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