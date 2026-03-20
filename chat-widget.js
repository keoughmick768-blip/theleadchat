// NineM's AI Chat Widget
// Embed this on any website to add an AI chatbot

(function() {
    // Get configuration from data attributes or URL params
    const script = document.currentScript;
    const config = {
        apiUrl: script?.dataset.api || 'http://localhost:3000',
        businessId: script?.dataset.business || new URLSearchParams(window.location.search).get('business') || 'demo',
        theme: script?.dataset.theme || 'dark',
        color: script?.dataset.color || '#667eea',
        position: script?.dataset.position || 'bottom-right'
    };
    
    // Create widget container
    const widget = document.createElement('div');
    widget.id = 'ninems-chat-widget';
    
    // Apply styles
    const style = document.createElement('style');
    style.textContent = `
        #ninems-chat-widget {
            position: fixed;
            ${config.position === 'bottom-right' ? 'bottom: 20px; right: 20px;' : 'bottom: 20px; left: 20px;'}
            z-index: 999999;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        
        #ninems-chat-toggle {
            width: 60px;
            height: 60px;
            border-radius: 50%;
            background: ${config.color};
            border: none;
            cursor: pointer;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 28px;
            transition: transform 0.2s;
        }
        
        #ninems-chat-toggle:hover {
            transform: scale(1.1);
        }
        
        #ninems-chat-window {
            display: none;
            position: absolute;
            bottom: 80px;
            right: 0;
            width: 380px;
            height: 500px;
            background: #1a1a2e;
            border-radius: 16px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.4);
            flex-direction: column;
            overflow: hidden;
        }
        
        #ninems-chat-window.open {
            display: flex;
            animation: ninems-slide-up 0.3s ease;
        }
        
        @keyframes ninems-slide-up {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .ninems-chat-header {
            background: ${config.color};
            padding: 16px 20px;
            color: white;
        }
        
        .ninems-chat-header h3 {
            font-size: 16px;
            margin-bottom: 4px;
        }
        
        .ninems-chat-header p {
            font-size: 12px;
            opacity: 0.9;
        }
        
        .ninems-chat-messages {
            flex: 1;
            padding: 16px;
            overflow-y: auto;
        }
        
        .ninems-message {
            max: 85%;
            padding: 12px 16px;
            border-radius: 14px;
            margin-bottom: 10px;
            font-size: 14px;
            line-height: 1.5;
        }
        
        .ninems-message.bot {
            background: #0f3460;
            color: white;
            border-bottom-left-radius: 4px;
        }
        
        .ninems-message.user {
            background: ${config.color};
            color: white;
            margin-left: auto;
            border-bottom-right-radius: 4px;
        }
        
        .ninems-chat-input {
            padding: 12px 16px;
            border-top: 1px solid #333;
            display: flex;
            gap: 8px;
        }
        
        .ninems-chat-input input {
            flex: 1;
            padding: 12px 16px;
            border: 1px solid #333;
            border-radius: 25px;
            background: #0f3460;
            color: white;
            font-size: 14px;
        }
        
        .ninems-chat-input input:focus {
            outline: none;
            border-color: ${config.color};
        }
        
        .ninems-chat-input button {
            width: 42px;
            height: 42px;
            border-radius: 50%;
            background: ${config.color};
            border: none;
            color: white;
            cursor: pointer;
            font-size: 18px;
        }
        
        .ninems-typing {
            display: none;
            padding: 12px 16px;
            background: #0f3460;
            border-radius: 14px;
            margin-bottom: 10px;
            width: fit-content;
        }
        
        .ninems-typing.show { display: block; }
        
        .ninems-typing span {
            display: inline-block;
            width: 8px;
            height: 8px;
            background: ${config.color};
            border-radius: 50%;
            margin: 0 2px;
            animation: ninems-bounce 1.4s infinite ease-in-out;
        }
        
        .ninems-typing span:nth-child(1) { animation-delay: 0s; }
        .ninems-typing span:nth-child(2) { animation-delay: 0.2s; }
        .ninems-typing span:nth-child(3) { animation-delay: 0.4s; }
        
        @keyframes ninems-bounce {
            0%, 80%, 100% { transform: translateY(0); }
            40% { transform: translateY(-8px); }
        }
        
        @media (max-width: 420px) {
            #ninems-chat-window {
                width: calc(100vw - 40px);
                height: calc(100vh - 120px);
            }
        }
    `;
    document.head.appendChild(style);
    
    // Build widget HTML
    widget.innerHTML = `
        <button id="ninems-chat-toggle">💬</button>
        <div id="ninems-chat-window">
            <div class="ninems-chat-header">
                <h3>🤖 AI Assistant</h3>
                <p>Ask me anything!</p>
            </div>
            <div class="ninems-chat-messages" id="ninems-messages">
                <div class="ninems-message bot">
                    👋 Hi there! Welcome!
                    <br><br>
                    I'm your AI assistant. How can I help you today?
                </div>
            </div>
            <div class="ninems-typing" id="ninems-typing">
                <span></span><span></span><span></span>
            </div>
            <div class="ninems-chat-input">
                <input type="text" id="ninems-input" placeholder="Type a message...">
                <button id="ninems-send">➤</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(widget);
    
    // Toggle chat window
    document.getElementById('ninems-chat-toggle').addEventListener('click', function() {
        document.getElementById('ninems-chat-window').classList.toggle('open');
    });
    
    // Send message
    function sendMessage() {
        const input = document.getElementById('ninems-input');
        const text = input.value.trim();
        if (!text) return;
        
        // Add user message
        const messages = document.getElementById('ninems-messages');
        messages.innerHTML += '<div class="ninems-message user">' + text + '</div>';
        input.value = '';
        messages.scrollTop = messages.scrollHeight;
        
        // Show typing
        document.getElementById('ninems-typing').classList.add('show');
        
        // Send to API (or use fallback)
        setTimeout(() => {
            document.getElementById('ninems-typing').classList.remove('show');
            
            // Simple response based on common questions
            let response = "Thanks for your message! ";
            
            const lower = text.toLowerCase();
            if (lower.includes('service') || lower.includes('offer') || lower.includes('what do you')) {
                response += "We offer a variety of services. Would you like more details?";
            } else if (lower.includes('price') || lower.includes('cost') || lower.includes('how much')) {
                response += "For pricing information, please contact us directly!";
            } else if (lower.includes('hour') || lower.includes('open') || lower.includes('time')) {
                response += "You can find our hours on our website or feel free to ask!";
            } else if (lower.includes('contact') || lower.includes('phone') || lower.includes('email') || lower.includes('reach')) {
                response += "You can reach us by phone or email. Would you like us to send you our contact info?";
            } else if (lower.includes('book') || lower.includes('appointment') || lower.includes('schedule')) {
                response += "We'd be happy to help you schedule an appointment!";
            } else {
                response += "Is there anything else you'd like to know about our business?";
            }
            
            messages.innerHTML += '<div class="ninems-message bot">' + response + '</div>';
            messages.scrollTop = messages.scrollHeight;
        }, 1500);
    }
    
    document.getElementById('ninems-send').addEventListener('click', sendMessage);
    document.getElementById('ninems-input').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') sendMessage();
    });
    
    // Expose API for customization
    window.NineMChat = {
        open: function() {
            document.getElementById('ninems-chat-window').classList.add('open');
        },
        close: function() {
            document.getElementById('ninems-chat-window').classList.remove('open');
        },
        setBusiness: function(name) {
            document.querySelector('.ninems-chat-header h3').textContent = '🤖 ' + name;
        }
    };
})();

