/**
 * NineM's AI Chat Widget
 * Embeddable on any website with one line:
 * <script src="https://your-server.com/chatbot-widget.js" data-api="https://your-server.com" data-business="Your Business Name"><\/script>
 */
(function() {
    'use strict';
    
    // Default configuration
    const defaultConfig = {
        apiUrl: window.location.origin,
        businessName: 'AI Assistant',
        businessType: 'Business',
        theme: 'dark',
        position: 'bottom-right',
        greeting: 'Hi there! 👋 How can I help you today?',
        primaryColor: '#667eea',
        model: 'qwen2.5:7b',
        avatar: null,
        positionX: '20px',
        positionY: '20px'
    };
    
    // Merge config from data attributes
    function getConfig() {
        const script = document.currentScript;
        const config = { ...defaultConfig };
        
        if (script) {
            config.apiUrl = script.getAttribute('data-api') || defaultConfig.apiUrl;
            config.businessName = script.getAttribute('data-business') || defaultConfig.businessName;
            config.businessType = script.getAttribute('data-type') || defaultConfig.businessType;
            config.theme = script.getAttribute('data-theme') || defaultConfig.theme;
            config.position = script.getAttribute('data-position') || defaultConfig.position;
            config.greeting = script.getAttribute('data-greeting') || defaultConfig.greeting;
            config.primaryColor = script.getAttribute('data-color') || defaultConfig.primaryColor;
            config.model = script.getAttribute('data-model') || defaultConfig.model;
            config.avatar = script.getAttribute('data-avatar');
            config.positionX = script.getAttribute('data-pos-x') || defaultConfig.positionX;
            config.positionY = script.getAttribute('data-pos-y') || defaultConfig.positionY;
        }
        
        // Also check URL params for overrides
        const urlParams = new URLSearchParams(window.location.search);
        ['api', 'business', 'type', 'theme', 'position', 'greeting', 'color', 'model', 'avatar', 'posX', 'posY'].forEach(key => {
            const paramKey = 'chat_' + key;
            if (urlParams.has(paramKey)) {
                config[key === 'api' ? 'apiUrl' : key === 'business' ? 'businessName' : key] = urlParams.get(paramKey);
            }
        });
        
        return config;
    }
    
    // Generate unique ID for this widget instance
    const widgetId = 'nineM-chat-' + Math.random().toString(36).substr(2, 9);
    let config;
    let chatHistory = [];
    let isOpen = false;
    
    // Create and inject styles
    function injectStyles() {
        const styles = `
            #${widgetId}-container {
                position: fixed;
                ${config.position.includes('bottom') ? 'bottom:' : 'top:'} ${config.positionY};
                ${config.position.includes('right') ? 'right:' : 'left:'} ${config.positionX};
                z-index: 999999;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }
            
            #${widgetId}-toggle {
                width: 60px;
                height: 60px;
                border-radius: 50%;
                background: ${config.primaryColor};
                border: none;
                cursor: pointer;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                display: flex;
                align-items: center;
                justify-content: center;
                transition: transform 0.3s ease;
            }
            
            #${widgetId}-toggle:hover {
                transform: scale(1.1);
            }
            
            #${widgetId}-toggle svg {
                width: 28px;
                height: 28px;
                fill: white;
            }
            
            #${widgetId}-toggle .chat-icon { display: block; }
            #${widgetId}-toggle .close-icon { display: none; }
            #${widgetId}-toggle.open .chat-icon { display: none; }
            #${widgetId}-toggle.open .close-icon { display: block; }
            
            #${widgetId}-widget {
                position: absolute;
                ${config.position.includes('bottom') ? 'bottom: 70px' : 'top: 70px'};
                ${config.position.includes('right') ? 'right: 0' : 'left: 0'};
                width: 380px;
                max-width: calc(100vw - 40px);
                height: 520px;
                max-height: calc(100vh - 100px);
                border-radius: 16px;
                overflow: hidden;
                box-shadow: 0 10px 40px rgba(0,0,0,0.4);
                opacity: 0;
                visibility: hidden;
                transform: translateY(20px) scale(0.95);
                transition: all 0.3s ease;
            }
            
            #${widgetId}-widget.open {
                opacity: 1;
                visibility: visible;
                transform: translateY(0) scale(1);
            }
            
            /* Theme styles */
            #${widgetId}-widget.dark {
                background: #0f0f23;
                color: #fff;
            }
            
            #${widgetId}-widget.light {
                background: #ffffff;
                color: #333;
            }
            
            #${widgetId}-header {
                background: linear-gradient(135deg, ${config.primaryColor} 0%, ${adjustColor(config.primaryColor, -30)} 100%);
                padding: 16px 20px;
                display: flex;
                align-items: center;
                gap: 12px;
            }
            
            #${widgetId}-header .avatar {
                width: 42px;
                height: 42px;
                border-radius: 50%;
                background: rgba(255,255,255,0.2);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 20px;
                overflow: hidden;
            }
            
            #${widgetId}-header .avatar img {
                width: 100%;
                height: 100%;
                object-fit: cover;
            }
            
            #${widgetId}-header .info h3 {
                font-size: 16px;
                font-weight: 600;
            }
            
            #${widgetId}-header .info p {
                font-size: 12px;
                opacity: 0.85;
            }
            
            #${widgetId}-messages {
                flex: 1;
                padding: 16px;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
                gap: 12px;
                ${config.theme === 'dark' ? 'background: #0f0f23;' : 'background: #f5f5f5;'}
            }
            
            #${widgetId}-widget.dark #${widgetId}-messages {
                background: #0f0f23;
            }
            
            #${widgetId}-widget.light #${widgetId}-messages {
                background: #f8f9fa;
            }
            
            #${widgetId}-message {
                max-width: 85%;
                padding: 12px 16px;
                border-radius: 16px;
                font-size: 14px;
                line-height: 1.5;
                word-wrap: break-word;
            }
            
            #${widgetId}-widget.dark #${widgetId}-message.bot {
                background: ${config.theme === 'dark' ? '#1e3a5f' : '#e8e8e8'};
                color: #fff;
                border-bottom-left-radius: 4px;
            }
            
            #${widgetId}-widget.light #${widgetId}-message.bot {
                background: #e8e8e8;
                color: #333;
                border-bottom-left-radius: 4px;
            }
            
            #${widgetId}-message.user {
                background: ${config.primaryColor};
                color: #fff;
                align-self: flex-end;
                border-bottom-right-radius: 4px;
            }
            
            #${widgetId}-typing {
                padding: 12px 16px;
                border-radius: 16px;
                border-bottom-left-radius: 4px;
                display: none;
                ${config.theme === 'dark' ? 'background: #1e3a5f;' : 'background: #e8e8e8;'}
            }
            
            #${widgetId}-typing.show { display: flex; gap: 4px; }
            
            #${widgetId}-typing span {
                width: 8px;
                height: 8px;
                background: ${config.primaryColor};
                border-radius: 50%;
                animation: ${widgetId}-bounce 1.4s infinite ease-in-out;
            }
            
            #${widgetId}-typing span:nth-child(1) { animation-delay: 0s; }
            #${widgetId}-typing span:nth-child(2) { animation-delay: 0.2s; }
            #${widgetId}-typing span:nth-child(3) { animation-delay: 0.4s; }
            
            @keyframes ${widgetId}-bounce {
                0%, 80%, 100% { transform: translateY(0); }
                40% { transform: translateY(-8px); }
            }
            
            #${widgetId}-quick-replies {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
                margin-top: 8px;
            }
            
            #${widgetId}-quick-reply {
                padding: 6px 12px;
                border-radius: 16px;
                font-size: 12px;
                cursor: pointer;
                transition: all 0.2s;
                border: 1px solid ${config.primaryColor};
                ${config.theme === 'dark' 
                    ? 'background: transparent; color: ' + config.primaryColor + ';' 
                    : 'background: ' + config.primaryColor + '; color: white;'}
            }
            
            #${widgetId}-quick-reply:hover {
                background: ${config.primaryColor};
                color: white !important;
            }
            
            #${widgetId}-input-area {
                padding: 12px 16px;
                display: flex;
                gap: 10px;
                ${config.theme === 'dark' ? 'background: #1a1a2e;' : 'background: #fff;'}
                border-top: 1px solid ${config.theme === 'dark' ? '#1e3a5f' : '#e0e0e0'};
            }
            
            #${widgetId}-input {
                flex: 1;
                padding: 10px 14px;
                border-radius: 20px;
                border: 1px solid ${config.theme === 'dark' ? '#1e3a5f' : '#ddd'};
                background: ${config.theme === 'dark' ? '#0f0f23' : '#f5f5f5'};
                color: ${config.theme === 'dark' ? '#fff' : '#333'};
                font-size: 14px;
                outline: none;
            }
            
            #${widgetId}-input:focus {
                border-color: ${config.primaryColor};
            }
            
            #${widgetId}-send {
                width: 40px;
                height: 40px;
                border-radius: 50%;
                background: ${config.primaryColor};
                border: none;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
            }
            
            #${widgetId}-send:hover {
                opacity: 0.9;
            }
            
            #${widgetId}-send svg {
                width: 18px;
                height: 18px;
                fill: white;
            }
            
            #${widgetId}-powered {
                text-align: center;
                padding: 8px;
                font-size: 10px;
                ${config.theme === 'dark' ? 'color: #666;' : 'color: #999;'}
            }
            
            #${widgetId}-powered a {
                color: ${config.primaryColor};
                text-decoration: none;
            }
            
            /* Light theme specific overrides */
            #${widgetId}-widget.light #${widgetId}-header {
                background: linear-gradient(135deg, ${config.primaryColor} 0%, ${adjustColor(config.primaryColor, -20)} 100%);
            }
            
            #${widgetId}-widget.light #${widgetId}-input::placeholder {
                color: #999;
            }
        `;
        
        const styleEl = document.createElement('style');
        styleEl.textContent = styles;
        document.head.appendChild(styleEl);
    }
    
    // Helper to adjust color brightness
    function adjustColor(color, amount) {
        const hex = color.replace('#', '');
        const r = Math.max(0, Math.min(255, parseInt(hex.substr(0, 2), 16) + amount));
        const g = Math.max(0, Math.min(255, parseInt(hex.substr(2, 2), 16) + amount));
        const b = Math.max(0, Math.min(255, parseInt(hex.substr(4, 2), 16) + amount));
        return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
    }
    
    // Create widget HTML
    function createWidget() {
        const container = document.createElement('div');
        container.id = widgetId + '-container';
        
        const avatarContent = config.avatar 
            ? `<img src="${config.avatar}" alt="${config.businessName}">`
            : '💬';
        
        container.innerHTML = `
            <div id="${widgetId}-widget" class="${config.theme}">
                <div id="${widgetId}-header">
                    <div class="avatar">${avatarContent}</div>
                    <div class="info">
                        <h3>${config.businessName}</h3>
                        <p>AI Assistant</p>
                    </div>
                </div>
                <div id="${widgetId}-messages"></div>
                <div id="${widgetId}-typing">
                    <span></span><span></span><span></span>
                </div>
                <div id="${widgetId}-input-area">
                    <input type="text" id="${widgetId}-input" placeholder="Type a message...">
                    <button id="${widgetId}-send">
                        <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                    </button>
                </div>
                <div id="${widgetId}-powered">Powered by <a href="#">NineM's AI</a></div>
            </div>
            <button id="${widgetId}-toggle">
                <svg class="chat-icon" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
                <svg class="close-icon" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
        `;
        
        document.body.appendChild(container);
    }
    
    // Initialize event listeners
    function initEvents() {
        const toggle = document.getElementById(widgetId + '-toggle');
        const widget = document.getElementById(widgetId + '-widget');
        const input = document.getElementById(widgetId + '-input');
        const sendBtn = document.getElementById(widgetId + '-send');
        
        toggle.addEventListener('click', () => {
            isOpen = !isOpen;
            toggle.classList.toggle('open', isOpen);
            widget.classList.toggle('open', isOpen);
            
            if (isOpen && !chatHistory.length) {
                // Show greeting on first open
                addMessage(config.greeting, 'bot', true);
            }
            
            if (isOpen) {
                setTimeout(() => input.focus(), 300);
            }
        });
        
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendMessage();
        });
        
        sendBtn.addEventListener('click', sendMessage);
    }
    
    // Add message to chat
    function addMessage(text, sender, isHtml = false) {
        const messages = document.getElementById(widgetId + '-messages');
        const div = document.createElement('div');
        div.id = widgetId + '-message';
        div.className = sender;
        
        if (isHtml) {
            div.innerHTML = text;
        } else {
            div.textContent = text;
        }
        
        messages.appendChild(div);
        messages.scrollTop = messages.scrollHeight;
    }
    
    // Show typing indicator
    function showTyping() {
        document.getElementById(widgetId + '-typing').classList.add('show');
        document.getElementById(widgetId + '-messages').scrollTop = document.getElementById(widgetId + '-messages').scrollHeight;
    }
    
    // Hide typing indicator
    function hideTyping() {
        document.getElementById(widgetId + '-typing').classList.remove('show');
    }
    
    // Send message to API
    async function sendMessage() {
        const input = document.getElementById(widgetId + '-input');
        const text = input.value.trim();
        
        if (!text) return;
        
        addMessage(text, 'user');
        input.value = '';
        
        await processWithAI(text);
    }
    
    // Process message with AI
    async function processWithAI(userMessage) {
        showTyping();
        chatHistory.push({ role: 'user', content: userMessage });
        
        try {
            // Try the API endpoint first
            let response;
            try {
                const res = await fetch(config.apiUrl + '/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: userMessage,
                        history: chatHistory.slice(-10),
                        business: config.businessName,
                        model: config.model
                    })
                });
                
                if (!res.ok) throw new Error('API error');
                const data = await res.json();
                response = data.response;
            } catch (apiError) {
                // Fallback to direct Ollama call if API unavailable
                console.log('API unavailable, trying direct Ollama...');
                response = await callOllamaDirect(userMessage);
            }
            
            hideTyping();
            addMessage(response, 'bot');
            chatHistory.push({ role: 'assistant', content: response });
            
        } catch (error) {
            console.error('AI Error:', error);
            hideTyping();
            addMessage("I'm having trouble thinking right now. Please try again!", 'bot');
        }
    }
    
    // Direct Ollama call (fallback)
    async function callOllamaDirect(userMessage) {
        const systemPrompt = `You are a helpful AI assistant for ${config.businessName}. 
Be friendly, concise, and helpful. Answer questions about the business.`;
        
        const response = await fetch('http://localhost:11434/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: config.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...chatHistory.slice(-6),
                    { role: 'user', content: userMessage }
                ],
                stream: false
            })
        });
        
        const data = await response.json();
        return data.message?.content || "I'm here to help! What would you like to know?";
    }
    
    // Initialize the widget
    function init() {
        config = getConfig();
        injectStyles();
        createWidget();
        initEvents();
        
        // Auto-open option (data-auto-open="true")
        const script = document.currentScript;
        if (script && script.getAttribute('data-auto-open') === 'true') {
            document.getElementById(widgetId + '-toggle').click();
        }
    }
    
    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
    // Expose API for programmatic control
    window.NineMChat = {
        open: () => document.getElementById(widgetId + '-toggle').click(),
        close: () => document.getElementById(widgetId + '-toggle').click(),
        send: (text) => {
            addMessage(text, 'user');
            processWithAI(text);
        },
        setBusiness: (name) => { config.businessName = name; },
        setConfig: (newConfig) => { config = { ...config, ...newConfig }; }
    };
    
})();

