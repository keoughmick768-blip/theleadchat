// Twilio Auto-Reply System
// Auto-responds to missed calls with SMS

const twilio = require('twilio');

// Your Twilio credentials (from OpenClaw)
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// Auto-reply to missed calls
async function handleMissedCall(fromNumber) {
    const message = `Hey! You called ${userBusinessName}. We're busy right now but wanted to follow up! 

What can we help you with? 

- Learn about our services
- Schedule an appointment
- Get our contact info

Reply to this message or call us back!`;
    
    try {
        await client.messages.create({
            body: message,
            from: TWILIO_PHONE_NUMBER,
            to: fromNumber
        });
        console.log(`Auto-reply sent to ${fromNumber}`);
        return { success: true };
    } catch (error) {
        console.error('Failed to send SMS:', error);
        return { success: false, error: error.message };
    }
}

// Handle incoming SMS
async function handleIncomingSMS(from, body) {
    // Get user's business info
    const userConfig = getUserConfigForPhone(from);
    
    // Generate AI response using Ollama
    const response = await generateAIResponse(body, userConfig);
    
    // Send response
    try {
        await client.messages.create({
            body: response,
            from: TWILIO_PHONE_NUMBER,
            to: from
        });
        return { success: true };
    } catch (error) {
        console.error('Failed to reply:', error);
        return { success: false };
    }
}

// Webhook endpoint for Twilio
app.post('/webhook/twilio', (req, res) => {
    const { From, CallStatus, Body } = req.body;
    
    // Handle missed call
    if (CallStatus === 'no-answer' || CallStatus === 'busy') {
        handleMissedCall(From);
    }
    
    // Handle incoming SMS
    if (Body) {
        handleIncomingSMS(From, Body);
    }
    
    res.sendStatus(200);
});

module.exports = { handleMissedCall, handleIncomingSMS };

