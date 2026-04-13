/**
 * TheLeadChat V2 - AI Receptionist for Realtors
 * Market-Ready SaaS Application
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'tlc_v2_super_secret_2026';

// =======================
// CONFIGURATION
// =======================

const CONFIG = {
    // Pricing Plans
    plans: {
        starter: {
            name: 'Starter',
            price: 97,
            priceId: 'price_starter_rtr_001',
            features: [
                '1 phone number',
                '500 AI responses/month',
                'Basic chat widget',
                'Lead dashboard',
                'Email support'
            ]
        },
        professional: {
            name: 'Professional',
            price: 197,
            priceId: 'price_pro_rtr_001',
            features: [
                '3 phone numbers',
                'Unlimited AI responses',
                'Advanced chat widget',
                'Calendar integration',
                'SMS marketing',
                'Priority support',
                'CRM sync',
                'Team management'
            ]
        },
        enterprise: {
            name: 'Enterprise',
            price: 397,
            priceId: 'price_entr_rtr_001',
            features: [
                'Unlimited phone numbers',
                'White-label',
                'API access',
                'Dedicated support',
                'Custom integrations',
                'Advanced analytics'
            ]
        }
    },
    
    // Default AI prompts for Realtors
    SYSTEM_PROMPTS: {
        receptionist: `You are a professional AI receptionist for a real estate agent named {agentName}.
        
You represent {brokerage}.
License #: {licenseNumber}

Areas served: {areas}
Specialties: {specialties}

Your job is to:
1. Greet callers warmly and professionally
2. Qualify their home buying/selling needs
3. Answer questions about listings, neighborhoods, market conditions
4. Explain the home buying/selling process
5. Offer to schedule property showings
6. Capture their contact information (name, phone, email)
7. Get their timeline and budget
8. Suggest next steps

Always:
- Be friendly and conversational
- Get their name first
- Ask about their needs before pitching
- Know current mortgage rates if asked (approx 6.5-7.5% for buyers)
- Have the agent's calendar link ready: {calendlyLink}
- Thank them for their time

Never:
- Be overly pushy or salesy
- Give legal or financial advice
- Discuss specific legal terms without noting you're not an attorney`
    }
};

// =======================
// MIDDLEWARE
// =======================

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(__dirname));

// Ensure data directory
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// =======================
// MONGODB CONNECTION
// =======================

const MONGODB_URI = process.env.MONGODB_URI;
if (MONGODB_URI) {
    console.log('🔄 Connecting to MongoDB...');
    mongoose.connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000
    })
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.log('❌ MongoDB Error:', err.message));
} else {
    console.log('⚠️ MongoDB not configured - using file storage');
}

// =======================
// DATABASE SCHEMAS
// =======================

// User Schema
const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    businessName: { type: String, default: '' },
    ownerName: { type: String, default: '' },
    phone: { type: String, default: '' },
    website: { type: String, default: '' },
    // Realtor-specific fields
    licenseNumber: { type: String, default: '' },
    brokerage: { type: String, default: '' },
    areas: [{ type: String }],
    specialties: [{ type: String }],
    bio: { type: String, default: '' },
    // Contact info for AI to know
    calendlyLink: { type: String, default: '' },
    ghlConnection: { type: Object, default: null },
    // Phone numbers
    twilioNumbers: [{ 
        number: String, 
        sid: String, 
        friendlyName: String,
        isPrimary: Boolean 
    }],
    // Subscription
    subscription: {
        plan: { type: String, default: 'starter' },
        status: { type: String, default: 'trial' },
        stripeCustomerId: String,
        stripeSubscriptionId: String,
        trialEndsAt: Date
    },
    // Stats
    stats: {
        totalLeads: { type: Number, default: 0 },
        qualifiedLeads: { type: Number, default: 0 },
        appointments: { type: Number, default: 0 },
        closedDeals: { type: Number, default: 0 },
        revenue: { type: Number, default: 0 }
    },
    // Team (Professional+)
    team: [{
        name: String,
        email: String,
        role: String,
        phone: String
    }],
    // Settings
    settings: {
        missedCallMessage: String,
        openingMessage: String,
        emailNotifications: { type: Boolean, default: true },
        smsNotifications: { type: Boolean, default: true }
    },
    // Timestamps
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Lead Schema
const leadSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    phone: { type: String, required: true },
    email: String,
    source: { type: String, enum: ['call', 'sms', 'widget', 'website'], default: 'sms' },
    status: { 
        type: String, 
        enum: ['new', 'contacted', 'qualified', 'appointment', 'showing', 'offer', 'closed', 'lost'], 
        default: 'new' 
    },
    // Qualification info
    budget: String,
    timeline: String,
    propertyType: String,
    bedrooms: Number,
    bathrooms: Number,
    areas: [String],
    notes: String,
    // Tracking
    convertedAt: Date,
    lastContactAt: Date,
    createdAt: { type: Date, default: Date.now }
});

// Message Schema
const messageSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
    direction: { type: String, enum: ['inbound', 'outbound'], required: true },
    content: { type: String, required: true },
    channel: { type: String, enum: ['sms', 'voice', 'widget'], default: 'sms' },
    timestamp: { type: Date, default: Date.now }
});

// Property Schema (Knowledge Base)
const propertySchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    address: { type: String, required: true },
    price: Number,
    beds: Number,
    baths: Number,
    sqft: Number,
    type: { type: String, enum: ['house', 'condo', 'townhouse', 'land', 'commercial'] },
    description: String,
    features: [String],
    neighborhood: String,
    schools: String,
    hoa: Number,
    yearBuilt: Number,
    images: [String],
    status: { type: String, enum: ['active', 'pending', 'sold'], default: 'active' },
    createdAt: { type: Date, default: Date.now }
});

// Appointment Schema
const appointmentSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
    propertyAddress: String,
    date: { type: Date, required: true },
    time: { type: String, required: true },
    status: { 
        type: String, 
        enum: ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'], 
        default: 'pending' 
    },
    notes: String,
    reminderSent: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

// Knowledge Base Q&A Schema
const knowledgeSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    question: { type: String, required: true },
    answer: { type: String, required: true },
    category: { type: String, enum: ['general', 'buying', 'selling', 'mortgage', 'neighborhood', 'process'], default: 'general' },
    createdAt: { type: Date, default: Date.now }
});

// Campaign Schema (SMS Marketing)
const campaignSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    content: { type: String, required: true },
    status: { type: String, enum: ['draft', 'scheduled', 'sending', 'completed'], default: 'draft' },
    leads: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Lead' }],
    scheduledAt: Date,
    sentAt: Date,
    stats: {
        sent: { type: Number, default: 0 },
        delivered: { type: Number, default: 0 },
        responses: { type: Number, default: 0 }
    },
    createdAt: { type: Date, default: Date.now }
});

// Create models
const User = mongoose.models.User || mongoose.model('User', userSchema);
const Lead = mongoose.models.Lead || mongoose.model('Lead', leadSchema);
const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);
const Property = mongoose.models.Property || mongoose.model('Property', propertySchema);
const Appointment = mongoose.models.Appointment || mongoose.model('Appointment', appointmentSchema);
const Knowledge = mongoose.models.Knowledge || mongoose.model('Knowledge', knowledgeSchema);
const Campaign = mongoose.models.Campaign || mongoose.model('Campaign', campaignSchema);

// =======================
// FILE STORAGE FALLBACK
// =======================

function getFilePath(collection, userId) {
    return path.join(DATA_DIR, `${collection}_${userId}.json`);
}

function loadFromFile(collection, userId) {
    try {
        const filePath = getFilePath(collection, userId);
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) {}
    return [];
}

function saveToFile(collection, userId, data) {
    try {
        fs.writeFileSync(getFilePath(collection, userId), JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Error saving to file:', e);
    }
}

// =======================
// AUTH MIDDLEWARE
// =======================

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        req.userId = null;
        return next();
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.userId = user.id;
        req.user = user;
        next();
    });
}

function requireAuth(req, res, next) {
    if (!req.userId) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
}

// Generate JWT
function generateToken(userId) {
    return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '30d' });
}

// =======================
// HELPER FUNCTIONS
// =======================

// Get Twilio client
function getTwilioClient() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) return null;
    const twilio = require('twilio')(accountSid, authToken);
    return twilio;
}

// Get Stripe instance
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
}

// Build AI prompt for Realtor
function buildRealtorPrompt(user) {
    let prompt = CONFIG.SYSTEM_PROMPTS.receptionist
        .replace('{agentName}', user.ownerName || user.businessName || 'Your Agent')
        .replace('{brokerage}', user.brokerage || 'Real Estate')
        .replace('{licenseNumber}', user.licenseNumber || 'N/A')
        .replace('{areas}', user.areas?.join(', ') || 'local area')
        .replace('{specialties}', user.specialties?.join(', ') || 'real estate')
        .replace('{calendlyLink}', user.calendlyLink || 'book a showing');
    
    return prompt;
}

// Generate AI response
async function generateAIResponse(user, userMessage, history = []) {
    const minimaxKey = process.env.MINIMAX_API_KEY;
    
    if (!minimaxKey) {
        return "Thanks for reaching out! I'll have our team contact you shortly. In the meantime, feel free to schedule a showing at " + (user.calendlyLink || 'our calendar');
    }
    
    const systemPrompt = buildRealtorPrompt(user);
    
    try {
        const messages = [
            { role: 'system', content: systemPrompt },
            ...history.slice(-10).map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: userMessage }
        ];
        
        const response = await axios.post('https://api.minimax.chat/v1/text/chatcompletion_v2', {
            model: 'abab6.5s-chat',
            messages: messages
        }, {
            headers: {
                'Authorization': `Bearer ${minimaxKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });
        
        if (response.data.base_resp?.status_code !== 0) {
            throw new Error(response.data.base_resp?.status_msg);
        }
        
        return response.data.choices?.[0]?.message?.content || response.data.reply;
        
    } catch (error) {
        console.error('AI Error:', error.message);
        // Fallback response
        return "Thanks for your message! " + (user.ownerName || 'Our team') + " will get back to you within 24 hours. Want to schedule a showing in the meantime? Check availability here: " + (user.calendlyLink || '');
    }
}

// =======================
// AUTH ROUTES
// =======================

// Signup
app.post('/api/auth/signup', async (req, res) => {
    const { email, password, businessName, ownerName } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password required' });
    }
    
    try {
        // Check if user exists
        if (mongoose.connection.readyState === 1) {
            const existing = await User.findOne({ email });
            if (existing) {
                return res.status(400).json({ error: 'Email already registered' });
            }
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Create trial (7 days)
        const trialEndsAt = new Date();
        trialEndsAt.setDate(trialEndsAt.getDate() + 7);
        
        let user;
        
        if (mongoose.connection.readyState === 1) {
            user = new User({
                email,
                password: hashedPassword,
                businessName: businessName || 'My Real Estate',
                ownerName: ownerName || 'Agent',
                subscription: {
                    plan: 'starter',
                    status: 'trial',
                    trialEndsAt
                },
                settings: {
                    openingMessage: "Hi! Thanks for contacting us. How can I help you today?",
                    missedCallMessage: "Hi! You called at a busy time. We'd love to help - reply to schedule a showing or call us directly!"
                }
            });
            
            await user.save();
            
            // Auto-provision Twilio number (if configured)
            const twilio = getTwilioClient();
            if (twilio) {
                try {
                    const numbers = await twilio.availablePhoneNumbers('US').tollFree.list({ limit: 5, capabilities: ['SMS'] });
                    if (numbers.length > 0) {
                        const purchased = await twilio.incomingPhoneNumbers.create({
                            phoneNumberSid: numbers[0].sid,
                            smsUrl: `${process.env.SERVER_URL}/api/webhook/twilio/sms`
                        });
                        user.twilioNumbers = [{
                            number: purchased.phoneNumber,
                            sid: purchased.sid,
                            friendlyName: 'Primary',
                            isPrimary: true
                        }];
                        await user.save();
                    }
                } catch (e) {
                    console.log('Could not provision number:', e.message);
                }
            }
        } else {
            // File storage fallback
            const userId = 'user_' + Date.now();
            user = {
                id: userId,
                email,
                password: hashedPassword,
                businessName: businessName || 'My Real Estate',
                ownerName: ownerName || 'Agent',
                subscription: { plan: 'starter', status: 'trial', trialEndsAt },
                stats: {},
                twilioNumbers: []
            };
            saveToFile('users', userId, [user]);
            // Note: This is simplified for file storage
        }
        
        const token = generateToken(user._id?.toString() || userId);
        
        res.json({ 
            success: true,
            token,
            user: {
                id: user._id?.toString() || userId,
                email: user.email,
                businessName: user.businessName,
                ownerName: user.ownerName,
                subscription: user.subscription
            }
        });
        
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password required' });
    }
    
    try {
        let user;
        
        if (mongoose.connection.readyState === 1) {
            user = await User.findOne({ email });
            if (!user) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }
            
            const validPassword = await bcrypt.compare(password, user.password);
            if (!validPassword) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }
        } else {
            return res.status(500).json({ error: 'Database not available' });
        }
        
        const token = generateToken(user._id.toString());
        
        res.json({ 
            success: true,
            token,
            user: {
                id: user._id.toString(),
                email: user.email,
                businessName: user.businessName,
                ownerName: user.ownerName,
                subscription: user.subscription,
                stats: user.stats
            }
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Forgot Password
app.post('/api/auth/forgot-password', async (req, res) => {
    const { email } = req.body;
    
    if (!email) {
        return res.status(400).json({ error: 'Email required' });
    }
    
    // In production: send reset email
    // For now: just log
    console.log(`Password reset requested for: ${email}`);
    
    res.json({ message: 'If an account exists, a reset link has been sent' });
});

// =======================
// USER ROUTES
// =======================

// Get current user
app.get('/api/user/me', authenticateToken, async (req, res) => {
    if (!req.userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    try {
        let user;
        
        if (mongoose.connection.readyState === 1) {
            user = await User.findById(req.userId).select('-password');
        } else {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({ user });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update profile
app.put('/api/user/profile', authenticateToken, async (req, res) => {
    if (!req.userId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { 
        businessName, ownerName, phone, website, 
        licenseNumber, brokerage, areas, specialties, bio, calendlyLink 
    } = req.body;
    
    try {
        let user;
        
        if (mongoose.connection.readyState === 1) {
            user = await User.findByIdAndUpdate(req.userId, {
                businessName, ownerName, phone, website,
                licenseNumber, brokerage, areas, specialties, bio, calendlyLink,
                updatedAt: new Date()
            }, { new: true }).select('-password');
        } else {
            return res.status(503).json({ error: 'Database not available' });
        }
        
        res.json({ success: true, user });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =======================
// LEADS ROUTES
// =======================

// Get all leads
app.get('/api/leads', authenticateToken, requireAuth, async (req, res) => {
    try {
        const { status, source } = req.query;
        
        let query = { userId: req.userId };
        if (status) query.status = status;
        if (source) query.source = source;
        
        let leads;
        
        if (mongoose.connection.readyState === 1) {
            leads = await Lead.find(query).sort({ createdAt: -1 });
        } else {
            leads = loadFromFile('leads', req.userId);
        }
        
        res.json({ leads });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create lead
app.post('/api/leads', authenticateToken, requireAuth, async (req, res) => {
    const { name, phone, email, source, budget, timeline, propertyType, notes } = req.body;
    
    if (!name || !phone) {
        return res.status(400).json({ error: 'Name and phone required' });
    }
    
    try {
        let lead;
        
        if (mongoose.connection.readyState === 1) {
            lead = new Lead({
                userId: req.userId,
                name, phone, email, source: source || 'manual',
                budget, timeline, propertyType, notes
            });
            await lead.save();
            
            // Update user stats
            await User.findByIdAndUpdate(req.userId, {
                $inc: { 'stats.totalLeads': 1 }
            });
        } else {
            lead = {
                id: 'lead_' + Date.now(),
                userId: req.userId,
                name, phone, email, source: source || 'manual',
                budget, timeline, propertyType, notes,
                status: 'new',
                createdAt: new Date().toISOString()
            };
            const leads = loadFromFile('leads', req.userId) || [];
            leads.push(lead);
            saveToFile('leads', req.userId, leads);
        }
        
        res.json({ success: true, lead });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update lead
app.put('/api/leads/:id', authenticateToken, requireAuth, async (req, res) => {
    const { name, phone, email, status, budget, timeline, notes } = req.body;
    
    try {
        let lead;
        
        if (mongoose.connection.readyState === 1) {
            lead = await Lead.findOneAndUpdate(
                { _id: req.params.id, userId: req.userId },
                { name, phone, email, status, budget, timeline, notes },
                { new: true }
            );
        } else {
            const leads = loadFromFile('leads', req.userId);
            lead = leads.find(l => l.id === req.params.id);
            if (lead) Object.assign(lead, req.body);
            saveToFile('leads', req.userId, leads);
        }
        
        res.json({ success: true, lead });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete lead
app.delete('/api/leads/:id', authenticateToken, requireAuth, async (req, res) => {
    try {
        if (mongoose.connection.readyState === 1) {
            await Lead.findOneAndDelete({ _id: req.params.id, userId: req.userId });
        } else {
            const leads = loadFromFile('leads', req.userId).filter(l => l.id !== req.params.id);
            saveToFile('leads', req.userId, leads);
        }
        
        res.json({ success: true });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =======================
// PROPERTIES ROUTES
// =======================

// Get properties
app.get('/api/properties', authenticateToken, requireAuth, async (req, res) => {
    try {
        let properties;
        
        if (mongoose.connection.readyState === 1) {
            properties = await Property.find({ userId: req.userId }).sort({ createdAt: -1 });
        } else {
            properties = loadFromFile('properties', req.userId);
        }
        
        res.json({ properties });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add property
app.post('/api/properties', authenticateToken, requireAuth, async (req, res) => {
    const { address, price, beds, baths, sqft, type, description, features, neighborhood, status } = req.body;
    
    if (!address) {
        return res.status(400).json({ error: 'Address required' });
    }
    
    try {
        let property;
        
        if (mongoose.connection.readyState === 1) {
            property = new Property({
                userId: req.userId,
                address, price, beds, baths, sqft, type, description, features, 
                neighborhood, status: status || 'active'
            });
            await property.save();
        } else {
            property = {
                id: 'prop_' + Date.now(),
                userId: req.userId,
                address, price, beds, baths, sqft, type, description, features, 
                neighborhood, status: status || 'active',
                createdAt: new Date().toISOString()
            };
            const properties = loadFromFile('properties', req.userId) || [];
            properties.push(property);
            saveToFile('properties', req.userId, properties);
        }
        
        res.json({ success: true, property });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =======================
// KNOWLEDGE BASE ROUTES
// =======================

// Get knowledge base
app.get('/api/knowledge', authenticateToken, requireAuth, async (req, res) => {
    try {
        let knowledge;
        
        if (mongoose.connection.readyState === 1) {
            knowledge = await Knowledge.find({ userId: req.userId }).sort({ createdAt: -1 });
        } else {
            knowledge = loadFromFile('knowledge', req.userId);
        }
        
        res.json({ knowledge });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add knowledge
app.post('/api/knowledge', authenticateToken, requireAuth, async (req, res) => {
    const { question, answer, category } = req.body;
    
    if (!question || !answer) {
        return res.status(400).json({ error: 'Question and answer required' });
    }
    
    try {
        let item;
        
        if (mongoose.connection.readyState === 1) {
            item = new Knowledge({
                userId: req.userId,
                question, answer, category
            });
            await item.save();
        } else {
            item = {
                id: 'kb_' + Date.now(),
                userId: req.userId,
                question, answer, category,
                createdAt: new Date().toISOString()
            };
            const knowledge = loadFromFile('knowledge', req.userId) || [];
            knowledge.push(item);
            saveToFile('knowledge', req.userId, knowledge);
        }
        
        res.json({ success: true, item });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete knowledge
app.delete('/api/knowledge/:id', authenticateToken, requireAuth, async (req, res) => {
    try {
        if (mongoose.connection.readyState === 1) {
            await Knowledge.findOneAndDelete({ _id: req.params.id, userId: req.userId });
        } else {
            const knowledge = loadFromFile('knowledge', req.userId).filter(k => k.id !== req.params.id);
            saveToFile('knowledge', req.userId, knowledge);
        }
        
        res.json({ success: true });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =======================
// APPOINTMENTS ROUTES
// =======================

// Get appointments
app.get('/api/appointments', authenticateToken, requireAuth, async (req, res) => {
    try {
        let appointments;
        
        if (mongoose.connection.readyState === 1) {
            appointments = await Appointment.find({ userId: req.userId })
                .populate('leadId')
                .sort({ date: -1 });
        } else {
            appointments = loadFromFile('appointments', req.userId);
        }
        
        res.json({ appointments });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Book appointment
app.post('/api/appointments', authenticateToken, requireAuth, async (req, res) => {
    const { leadId, propertyAddress, date, time, notes } = req.body;
    
    if (!date || !time) {
        return res.status(400).json({ error: 'Date and time required' });
    }
    
    try {
        let appointment;
        
        if (mongoose.connection.readyState === 1) {
            appointment = new Appointment({
                userId: req.userId,
                leadId, propertyAddress, date, time, notes
            });
            await appointment.save();
            
            // Update lead status
            if (leadId) {
                await Lead.findByIdAndUpdate(leadId, {
                    status: 'appointment',
                    lastContactAt: new Date()
                });
            }
            
            // Update stats
            await User.findByIdAndUpdate(req.userId, {
                $inc: { 'stats.appointments': 1 }
            });
        } else {
            appointment = {
                id: 'apt_' + Date.now(),
                userId: req.userId,
                leadId, propertyAddress, date, time, notes,
                status: 'pending',
                createdAt: new Date().toISOString()
            };
            const appointments = loadFromFile('appointments', req.userId) || [];
            appointments.push(appointment);
            saveToFile('appointments', req.userId, appointments);
        }
        
        res.json({ success: true, appointment });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =======================
// CHAT API
// =======================

// Send chat message
app.post('/api/chat', authenticateToken, async (req, res) => {
    const { message, history = [], leadId } = req.body;
    
    if (!message) {
        return res.status(400).json({ error: 'Message required' });
    }
    
    try {
        // Get user config
        let user;
        
        if (mongoose.connection.readyState === 1 && req.userId) {
            user = await User.findById(req.userId);
        }
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Generate AI response
        const response = await generateAIResponse(user, message, history);
        
        // Save message if we have a lead
        if (leadId && mongoose.connection.readyState === 1) {
            const msg = new Message({
                userId: req.userId,
                leadId,
                direction: 'outbound',
                content: response,
                channel: 'widget'
            });
            await msg.save();
        }
        
        res.json({ response, history: [...history, { role: 'user', content: message }, { role: 'assistant', content: response }] });
        
    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({ error: error.message });
    }
});

// =======================
// STRIPE ROUTES
// =======================

// Get pricing plans
app.get('/api/pricing', (req, res) => {
    res.json({ plans: CONFIG.plans });
});

// Create checkout session
app.post('/api/stripe/checkout', authenticateToken, requireAuth, async (req, res) => {
    const { planId } = req.body;
    
    if (!stripe) {
        return res.status(500).json({ error: 'Stripe not configured' });
    }
    
    const plan = CONFIG.plans[planId];
    if (!plan) {
        return res.status(400).json({ error: 'Invalid plan' });
    }
    
    try {
        let user = await User.findById(req.userId);
        
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: `TheLeadChat ${plan.name} - Realtor Edition`,
                        description: `${plan.features.length} features included`
                    },
                    unit_amount: plan.price * 100,
                    recurring: { interval: 'month' }
                },
                quantity: 1
            }],
            mode: 'subscription',
            success_url: `${process.env.FRONTEND_URL}/dashboard?payment=success`,
            cancel_url: `${process.env.FRONTEND_URL}/pricing?payment=cancelled`,
            customer_email: user.email,
            metadata: {
                userId: req.userId,
                plan: planId
            }
        });
        
        res.json({ sessionId: session.id, url: session.url });
        
    } catch (error) {
        console.error('Stripe error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Stripe webhook
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    if (!stripe) {
        return res.status(500).json({ error: 'Stripe not configured' });
    }
    
    const sig = req.headers['stripe-signature'];
    let event;
    
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    
    switch (event.type) {
        case 'checkout.session.completed': {
            const session = event.data.object;
            const { userId, plan } = session.metadata;
            
            console.log(`✅ Payment completed for user ${userId}, plan: ${plan}`);
            
            if (mongoose.connection.readyState === 1) {
                await User.findByIdAndUpdate(userId, {
                    subscription: {
                        plan,
                        status: 'active',
                        stripeCustomerId: session.customer,
                        stripeSubscriptionId: session.subscription
                    }
                });
            }
            break;
        }
        
        case 'customer.subscription.deleted': {
            const subscription = event.data.object;
            console.log(`Subscription cancelled: ${subscription.id}`);
            // Update user status
            break;
        }
    }
    
    res.json({ received: true });
});

// =======================
// TWILIO WEBHOOKS
// =======================

// Incoming SMS
app.post('/api/webhook/twilio/sms', express.urlencoded({ extended: false }), async (req, res) => {
    const from = req.body.From;
    const body = req.body.Body;
    const to = req.body.To;
    
    console.log(`💬 SMS from ${from}: ${body}`);
    
    if (!from || !body) {
        return res.status(400).send('Missing parameters');
    }
    
    try {
        // Find user by their Twilio number
        let user;
        let userId = null;
        
        if (mongoose.connection.readyState === 1) {
            user = await User.findOne({ 'twilioNumbers.number': to });
            if (user) userId = user._id;
        }
        
        if (!user) {
            console.log('No user found for number:', to);
            const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Thanks for reaching out! This number isn't configured yet.</Message></Response>`;
            res.type('text/xml').send(twiml);
            return;
        }
        
        // Save incoming message
        if (mongoose.connection.readyState === 1) {
            // Check if we have a lead from this number
            let lead = await Lead.findOne({ phone: from, userId });
            
            if (!lead) {
                // Create new lead
                lead = new Lead({
                    userId,
                    name: 'Unknown',
                    phone: from,
                    source: 'sms'
                });
                await lead.save();
                
                await User.findByIdAndUpdate(userId, {
                    $inc: { 'stats.totalLeads': 1 }
                });
            }
            
            // Save message
            const msg = new Message({
                userId,
                leadId: lead._id,
                direction: 'inbound',
                content: body,
                channel: 'sms'
            });
            await msg.save();
            
            // Get message history for AI
            const history = await Message.find({ leadId: lead._id }).sort({ timestamp: -1 }).limit(20);
            
            // Generate response
            const response = await generateAIResponse(user, body, history.map(m => ({
                role: m.direction === 'inbound' ? 'user' : 'assistant',
                content: m.content
            })));
            
            // Save response
            const responseMsg = new Message({
                userId,
                leadId: lead._id,
                direction: 'outbound',
                content: response,
                channel: 'sms'
            });
            await responseMsg.save();
            
            // Send via Twilio
            const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${response}</Message></Response>`;
            res.type('text/xml').send(twiml);
            
        } else {
            res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
        }
        
    } catch (error) {
        console.error('SMS webhook error:', error);
        res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Message>Error. Please try again.</Message></Response>');
    }
});

// Missed call webhook
app.post('/api/webhook/twilio/missed-call', express.urlencoded({ extended: false }), async (req, res) => {
    const from = req.body.From;
    const to = req.body.To;
    
    console.log(`📞 Missed call from ${from} to ${to}`);
    
    try {
        let user;
        
        if (mongoose.connection.readyState === 1) {
            user = await User.findOne({ 'twilioNumbers.number': to });
        }
        
        if (!user) {
            res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
            return;
        }
        
        // Send auto-SMS
        const twilio = getTwilioClient();
        if (twilio) {
            const message = user.settings?.missedCallMessage || 
                "Hi! You called at a busy time. We'd love to help - reply to this message or visit our website to schedule a showing!";
            
            await twilio.messages.create({
                body: message,
                from: to,
                to: from
            });
            
            console.log(`✅ Auto-reply sent to ${from}`);
        }
        
        res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>Thanks for calling! We've sent you a text message.</Say></Response>`);
        
    } catch (error) {
        console.error('Missed call error:', error);
        res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
});

// Voice webhook
app.post('/api/webhook/twilio/voice', express.urlencoded({ extended: false }), async (req, res) => {
    const from = req.body.From;
    const to = req.body.To;
    
    console.log(`📞 Voice call from ${from} to ${to}`);
    
    // Forward to agent's phone
    let forwardTo = '+19802450074'; // Default - Mick
    
    try {
        if (mongoose.connection.readyState === 1) {
            const user = await User.findOne({ 'twilioNumbers.number': to });
            if (user?.phone) {
                forwardTo = user.phone;
            }
        }
    } catch (e) {
        console.error('Voice webhook error:', e);
    }
    
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Joanna-Neural">Thanks for calling! Connecting you now.</Say>
    <Dial>
        <Number>${forwardTo}</Number>
    </Dial>
</Response>`;
    
    res.type('text/xml').send(twiml);
});

// =======================
// ANALYTICS ROUTES
// =======================

// Get analytics overview
app.get('/api/analytics/overview', authenticateToken, requireAuth, async (req, res) => {
    try {
        let user, leads, appointments;
        
        if (mongoose.connection.readyState === 1) {
            user = await User.findById(req.userId);
            leads = await Lead.find({ userId: req.userId });
            appointments = await Appointment.find({ userId: req.userId });
        }
        
        const totalLeads = leads?.length || 0;
        const newLeads = leads?.filter(l => l.status === 'new').length || 0;
        const qualified = leads?.filter(l => ['qualified', 'appointment', 'showing'].includes(l.status)).length || 0;
        const closed = leads?.filter(l => l.status === 'closed').length || 0;
        const appointmentsScheduled = appointments?.filter(a => a.status === 'confirmed').length || 0;
        
        res.json({
            totalLeads,
            newLeads,
            qualified,
            closed,
            appointmentsScheduled,
            conversionRate: totalLeads ? Math.round((closed / totalLeads) * 100) : 0,
            stats: user?.stats || {}
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =======================
// DEBUG ROUTES
// =======================

app.get('/api/debug/status', (req, res) => {
    res.json({
        mongoose: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        twilio: !!process.env.TWILIO_ACCOUNT_SID,
        stripe: !!process.env.STRIPE_SECRET_KEY,
        minimax: !!process.env.MINIMAX_API_KEY
    });
});

// =======================
// FRONTEND ROUTES
// =======================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/dashboard*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/signup', (req, res) => {
    res.sendFile(path.join(__dirname, 'signup.html'));
});

app.get('/pricing', (req, res) => {
    res.sendFile(path.join(__dirname, 'pricing.html'));
});

app.get('/settings', (req, res) => {
    res.sendFile(path.join(__dirname, 'settings.html'));
});

app.get('/leads*', (req, res) => {
    res.sendFile(path.join(__dirname, 'leads.html'));
});

app.get('/properties*', (req, res) => {
    res.sendFile(path.join(__dirname, 'properties.html'));
});

app.get('/calendar*', (req, res) => {
    res.sendFile(path.join(__dirname, 'calendar.html'));
});

app.get('/analytics*', (req, res) => {
    res.sendFile(path.join(__dirname, 'analytics.html'));
});

// =======================
// START SERVER
// =======================

app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                    ║
║   🏠 TheLeadChat V2 - Realtor Edition               ║
║   AI Receptionist for Real Estate                   ║
║                                                    ║
║   Server running on port ${PORT}                        ║
║   ${process.env.FRONTEND_URL || 'http://localhost:' + PORT}               ║
║                                                    ║
╚════════════════════════════════════════════════════════════╝
    `);
});

module.exports = app;