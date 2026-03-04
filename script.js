const textarea = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const messagesWrapper = document.getElementById('messages-wrapper');
const chatContainer = document.getElementById('chat-container');
const themeToggle = document.getElementById('theme-toggle');

// --- OLLAMA CONFIGURATION ---
const NGROK_URL = "https://inge-unidolized-kaylee.ngrok-free.dev"; // PASTE YOUR NGROK URL HERE
const MODEL_NAME = "qwen2.5:32b";
let isGenerating = false; 

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

async function sendMessage() {
    const text = textarea.value.trim();
    if (!text) return;

    isGenerating = true;
    sendBtn.disabled = true;

    appendUserMessage(text);
    textarea.value = '';
    textarea.style.height = '24px';
    scrollToBottom();

    const botRow = appendBotMessage(""); 
    const responseTextElement = botRow.querySelector('p');

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

        if (!response.ok) throw new Error("Network response was not ok");

        const reader = response.body.getReader();
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
                        scrollToBottom();
                    }
                } catch (e) {
                    console.error("Skipped malformed JSON chunk:", line);
                }
            }
        }
    } catch (error) {
        responseTextElement.textContent = "Error: Could not connect to Ollama. Check your ngrok URL and ensure OLLAMA_ORIGINS=\"*\" is set.";
        console.error(error);
    } finally {
        isGenerating = false;
        sendBtn.disabled = false;
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