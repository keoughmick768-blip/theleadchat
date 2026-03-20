# NineM's AI Chatbot SaaS Platform

An embeddable AI chatbot solution that businesses can add to their websites with a single line of code. Includes phone/SMS integration via Twilio and calendar booking.

## Features

- **Embeddable Widget** - One line of code to add AI chat to any website
- **Smart AI** - Powered by Ollama for intelligent responses
- **Twilio Integration** - Auto-reply to missed calls and SMS
- **Lead Management** - Capture and track leads from chat/SMS
- **Calendar Booking** - Simple appointment scheduling
- **Customizable** - Themes, colors, greetings, and more

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
npm start
```

The server runs on `http://localhost:3000`

### 3. Add the Widget to Your Site

```html
<script src="http://localhost:3000/chatbot-widget.js" 
  data-api="http://localhost:3000"
  data-business="Your Business Name"
  data-theme="dark"
  data-color="#667eea">
</script>
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/chat` | Send message to AI |
| GET | `/api/user/:id` | Get user configuration |
| POST | `/api/auth/signup` | Create new account |
| POST | `/api/auth/login` | Login |
| GET | `/api/leads` | Get all leads |
| GET | `/api/calendar/availability` | Check appointment availability |
| POST | `/api/calendar/book` | Book appointment |
| POST | `/api/webhook/twilio` | Twilio SMS webhook |
| GET | `/api/embed/:userId` | Get widget embed code |

## Configuration Options

| Attribute | Description | Default |
|-----------|-------------|---------|
| `data-api` | API server URL | current origin |
| `data-business` | Business name | "AI Assistant" |
| `data-type` | Business type | "Business" |
| `data-theme` | "dark" or "light" | "dark" |
| `data-color` | Primary color | "#667eea" |
| `data-position` | Widget position | "bottom-right" |
| `data-greeting` | Welcome message | "Hi there! 👋" |
| `data-model` | Ollama model | "qwen2.5:7b" |
| `data-auto-open` | Auto-open widget | false |

## Position Options

- `bottom-right` (default)
- `bottom-left`
- `top-right`
- `top-left`

## JavaScript API

```javascript
// Open/close widget
NineMChat.open();
NineMChat.close();

// Send message programmatically
NineMChat.send("Hello!");

// Update config
NineMChat.setConfig({ businessName: "New Name" });
```

## Twilio Setup

Set these environment variables:

```bash
export TWILIO_ACCOUNT_SID=your_account_sid
export TWILIO_AUTH_TOKEN=your_auth_token
export TWILIO_PHONE_NUMBER=+1234567890
```

Configure Twilio webhooks:
- SMS Webhook: `https://your-server.com/api/webhook/twilio`
- Voice Webhook: `https://your-server.com/api/webhook/twilio/missed-call`

## File Structure

```
ai-chatbot-saas/
├── index.html          # Landing page
├── signup.html         # Signup page
├── dashboard.html      # User dashboard
├── chatbot-smart.html  # Full chatbot demo
├── chatbot-widget.js   # Embeddable widget
├── widget-demo.html    # Widget demo page
├── server.js           # Express server
├── package.json        # Dependencies
└── data/               # User data (created on first run)
    ├── users.json
    ├── chat_*.json
    ├── leads.json
    └── bookings.json
```

## Demo

Visit `http://localhost:3000/widget-demo` to see different theme/color combinations.
