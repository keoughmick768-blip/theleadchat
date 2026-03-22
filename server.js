/**
 * NineM's AI Chatbot SaaS - Backend Server
 * Handles: Static files, Auth, Ollama proxy, Chat history, Twilio webhooks
 */

// Load environment variables
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'nineM-secret-key-change-in-production';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MONGODB_URI = process.env.MONGODB_URI || '';

// Stripe Configuration
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://theleadchat.onrender.com';

// Support email (for now, all support emails go here)
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'keoughmick768@gmail.com';

let stripe;
if (STRIPE_SECRET_KEY) {
    stripe = require('stripe')(STRIPE_SECRET_KEY);
    console.log('💳 Stripe configured');
}

// Pricing Plans
const PRICING_PLANS = {
    starter: {
        name: 'Starter',
        price: 59,
        priceId: 'price_1TDfdbBOBGfZXbEsqHLFBAzS',  // Stripe price ID
        features: [
            '1 phone number',
            '100 AI responses/month',
            'Basic chat widget',
            'Email support'
        ]
    },
    professional: {
        name: 'Pro',
        price: 97,
        priceId: 'price_1TDfdhBOBGfZXbEsUv25JtaH',  // Stripe price ID
        features: [
            '3 phone numbers',
            'Unlimited AI responses',
            'Advanced chat widget',
            'Calendar integration',
            'Priority support',
            'Lead analytics'
        ]
    }
};

// MongoDB Connection
if (MONGODB_URI) {
    console.log('🔄 Attempting MongoDB connection...');
    mongoose.connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000
    })
        .then(() => console.log('✅ Connected to MongoDB'))
        .catch(err => console.log('❌ MongoDB connection error:', err.message));
} else {
    console.log('⚠️ MONGODB_URI not set - using in-memory storage');
}

// User Schema
const userSchema = new mongoose.Schema({
    businessName: String,
    ownerName: String,
    email: String,
    password: String,
    phone: String,
    website: String,
    services: String,
    areas: String,
    unique: String,
    offers: String,
    openingMessage: String,
    conversationGoal: { type: String, default: 'answer_questions' }, // answer_questions, book_appointment, collect_info
    setupComplete: { type: Boolean, default: false },
    twilioNumber: String,
    twilioSid: String,
    twilioToken: String,
    calendlyLink: String,
    resetToken: String,
    resetTokenExpiry: Date,
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.models.User || mongoose.model('User', userSchema);

// Knowledge Base Schema (Q&A pairs)
const knowledgeBaseSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    question: { type: String, required: true },
    answer: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
const KnowledgeBase = mongoose.models.KnowledgeBase || mongoose.model('KnowledgeBase', knowledgeBaseSchema);

// Flagged Questions Schema (unknown questions for review)
const flaggedQuestionSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    question: { type: String, required: true },
    conversationId: String,
    flaggedAt: { type: Date, default: Date.now },
    resolved: { type: Boolean, default: false },
    answer: String,
    resolvedAt: Date
});
const FlaggedQuestion = mongoose.models.FlaggedQuestion || mongoose.model('FlaggedQuestion', flaggedQuestionSchema);

// =======================
// DATABASE API ROUTES
// =======================

// API: Get all users (admin)
app.get('/api/admin/users', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({ error: 'Database not connected' });
        }
        const users = await User.find().sort({ createdAt: -1 });
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Create user (admin)
app.post('/api/admin/users', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({ error: 'Database not connected' });
        }
        const user = new User(req.body);
        await user.save();
        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Update user
app.put('/api/admin/users/:id', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({ error: 'Database not connected' });
        }
        const user = await User.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Delete user
app.delete('/api/admin/users/:id', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({ error: 'Database not connected' });
        }
        await User.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Get user by email
app.get('/api/user/email/:email', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({ error: 'Database not connected' });
        }
        const user = await User.findOne({ email: req.params.email });
        res.json(user || null);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Save user settings
app.post('/api/user/settings', async (req, res) => {
    try {
        const { email, ...data } = req.body;
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({ error: 'Database not connected' });
        }
        let user = await User.findOne({ email });
        if (user) {
            user = await User.findOneAndUpdate({ email }, data, { new: true });
        } else {
            user = new User({ email, ...data });
            await user.save();
        }
        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from current directory
app.use(express.static(__dirname));

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// =======================
// AUTH MIDDLEWARE
// =======================

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        // For development, allow requests without token but mark as unauthenticated
        req.userId = 'demo';
        return next();
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        req.userId = user.id;
        next();
    });
}

// Generate JWT token
function generateToken(userId) {
    return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '7d' });
}

// =======================
// USER MANAGEMENT
// =======================

// In-memory user store (replace with database in production)
const users = new Map();

// Load users from file
const USERS_FILE = path.join(DATA_DIR, 'users.json');
function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
            data.forEach(user => users.set(user.id, user));
        }
    } catch (e) {
        console.log('No existing users file');
    }
}
loadUsers();

function saveUsers() {
    const data = Array.from(users.values());
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

// API: Create user / Signup 
app.post('/api/auth/signup', async (req, res) => {
    const { email, password, businessName } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password required' });
    }
    
    try {
        // Check if MongoDB is connected
        if (mongoose.connection.readyState === 1) {
            // Use MongoDB
            const existingUser = await User.findOne({ email });
            if (existingUser) {
                return res.status(400).json({ error: 'Email already registered' });
            }
            
            const hashedPassword = await bcrypt.hash(password, 10);
            const newUser = new User({
                email,
                password: hashedPassword,
                businessName: businessName || 'My Business',
                setupComplete: false
            });
            
            await newUser.save();
            
            // Auto-assign a Twilio phone number
            const assignedNumber = await assignPhoneNumberToUser(newUser._id.toString());
            if (assignedNumber) {
                newUser.twilioNumber = assignedNumber;
                await newUser.save();
            }
            
            const token = generateToken(newUser._id.toString());
            return res.json({ 
                token, 
                user: { 
                    id: newUser._id, 
                    email: newUser.email, 
                    businessName: newUser.businessName,
                    setupComplete: false,
                    twilioNumber: assignedNumber
                } 
            });
        } else {
            // Fallback: use in-memory storage
            for (const user of users.values()) {
                if (user.email === email) {
                    return res.status(400).json({ error: 'Email already registered' });
                }
            }
            
            const userId = 'user_' + Date.now();
            
            // Auto-assign a Twilio phone number
            const assignedNumber = await assignPhoneNumberToUser(userId);
            
            const user = {
                id: userId,
                email,
                password,
                businessName: businessName || 'My Business',
                setupComplete: false,
                twilioNumber: assignedNumber,
                createdAt: new Date().toISOString()
            };
            
            users.set(userId, user);
            saveUsers();
            
            const token = generateToken(userId);
            res.json({ token, user: { id: userId, email, businessName: user.businessName, setupComplete: false, twilioNumber: assignedNumber } });
        }
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: Login 
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password required' });
    }
    
    try {
        // Check if MongoDB is connected
        if (mongoose.connection.readyState === 1) {
            const user = await User.findOne({ email });
            if (!user) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }
            
            const validPassword = await bcrypt.compare(password, user.password);
            if (!validPassword) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }
            
            const token = generateToken(user._id.toString());
            return res.json({ 
                token, 
                user: { 
                    id: user._id, 
                    email: user.email, 
                    businessName: user.businessName,
                    setupComplete: user.setupComplete !== false
                } 
            });
        } else {
            // Fallback: use in-memory storage
            for (const user of users.values()) {
                if (user.email === email && user.password === password) {
                    const token = generateToken(user.id);
                    return res.json({ 
                        token, 
                        user: { 
                            id: user.id, 
                            email: user.email, 
                            businessName: user.businessName,
                            setupComplete: user.setupComplete !== false
                        } 
                    });
                }
            }
            return res.status(401).json({ error: 'Invalid credentials' });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: Forgot Password - Send reset email
app.post('/api/auth/forgot-password', async (req, res) => {
    const { email } = req.body;
    
    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }
    
    try {
        // Generate reset token
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetTokenExpiry = Date.now() + 3600000; // 1 hour
        
        if (mongoose.connection.readyState === 1) {
            const user = await User.findOne({ email });
            if (!user) {
                // Don't reveal if user exists
                return res.json({ message: 'If an account exists, a reset link has been sent' });
            }
            
            user.resetToken = resetToken;
            user.resetTokenExpiry = resetTokenExpiry;
            await user.save();
            
            // In production, send email here
            console.log(`🔐 Password reset for ${email}: ${resetToken}`);
            console.log(`🔗 Reset link: ${FRONTEND_URL}/reset-password.html?token=${resetToken}`);
            console.log(`📧 Would send to: ${SUPPORT_EMAIL}`);
            
            return res.json({ message: 'If an account exists, a reset link has been sent' });
        } else {
            // Fallback to in-memory
            for (const [id, user] of users.entries()) {
                if (user.email === email) {
                    user.resetToken = resetToken;
                    user.resetTokenExpiry = resetTokenExpiry;
                    console.log(`🔐 Password reset for ${email}: ${resetToken}`);
                    console.log(`🔗 Reset link: ${FRONTEND_URL}/reset-password.html?token=${resetToken}`);
                    console.log(`📧 Would send to: ${SUPPORT_EMAIL}`);
                    break;
                }
            }
            return res.json({ message: 'If an account exists, a reset link has been sent' });
        }
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: 'Failed to process request' });
    }
});

// API: Reset Password
app.post('/api/auth/reset-password', async (req, res) => {
    const { token, password } = req.body;
    
    if (!token || !password) {
        return res.status(400).json({ error: 'Token and password required' });
    }
    
    try {
        if (mongoose.connection.readyState === 1) {
            const user = await User.findOne({ 
                resetToken: token,
                resetTokenExpiry: { $gt: Date.now() }
            });
            
            if (!user) {
                return res.status(400).json({ error: 'Invalid or expired reset token' });
            }
            
            // Hash new password
            const hashedPassword = await bcrypt.hash(password, 10);
            user.password = hashedPassword;
            user.resetToken = null;
            user.resetTokenExpiry = null;
            await user.save();
            
            return res.json({ message: 'Password reset successful' });
        } else {
            // Fallback to in-memory
            for (const [id, user] of users.entries()) {
                if (user.resetToken === token && user.resetTokenExpiry > Date.now()) {
                    user.password = password;
                    user.resetToken = null;
                    user.resetTokenExpiry = null;
                    return res.json({ message: 'Password reset successful' });
                }
            }
            return res.status(400).json({ error: 'Invalid or expired reset token' });
        }
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

// =======================
// STRIPE PAYMENT ROUTES
// =======================

// Debug: Check MongoDB connection status
app.get('/api/debug/status', (req, res) => {
    const states = {
        0: 'disconnected',
        1: 'connected', 
        2: 'connecting',
        3: 'disconnecting'
    };
    res.json({
        mongooseState: mongoose.connection.readyState,
        stateName: states[mongoose.connection.readyState] || 'unknown',
        mongoUriSet: !!process.env.MONGODB_URI,
        minimaxKeySet: !!process.env.MINIMAX_API_KEY,
        minimaxKeyPrefix: process.env.MINIMAX_API_KEY ? process.env.MINIMAX_API_KEY.substring(0, 10) + '...' : 'NOT SET'
    });
});

// Get pricing plans
app.get('/api/pricing', (req, res) => {
    res.json({ plans: PRICING_PLANS });
});

// Contact/Support form
app.post('/api/contact', async (req, res) => {
    const { name, email, subject, message } = req.body;
    
    if (!name || !email || !message) {
        return res.status(400).json({ error: 'Name, email, and message required' });
    }
    
    // Log support request (in production, send actual email)
    console.log('='.repeat(50));
    console.log('📧 NEW SUPPORT REQUEST');
    console.log(`From: ${name} (${email})`);
    console.log(`Subject: ${subject || 'No subject'}`);
    console.log(`Message: ${message}`);
    console.log(`Send to: ${SUPPORT_EMAIL}`);
    console.log('='.repeat(50));
    
    res.json({ message: 'Support request received. We will get back to you soon!' });
});

// Create checkout session
app.post('/api/stripe/create-checkout-session', authenticateToken, async (req, res) => {
    const { planId } = req.body;
    const userId = req.user.id || req.userId;
    
    if (!stripe) {
        return res.status(500).json({ error: 'Stripe not configured' });
    }
    
    const plan = PRICING_PLANS[planId];
    if (!plan) {
        return res.status(400).json({ error: 'Invalid plan' });
    }
    
    try {
        // Get user email
        let userEmail = '';
        if (mongoose.connection.readyState === 1) {
            const user = await User.findById(userId);
            userEmail = user?.email || '';
        } else {
            const user = users.get(userId);
            userEmail = user?.email || '';
        }
        
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price: plan.priceId,  // Use lookup_key from pricing plan
                quantity: 1
            }],
            mode: 'subscription',
            success_url: `${FRONTEND_URL}/dashboard.html?payment=success`,
            cancel_url: `${FRONTEND_URL}/pricing.html?payment=cancelled`,
            customer_email: userEmail,
            metadata: {
                userId: userId,
                plan: planId
            }
        });
        
        res.json({ sessionId: session.id, url: session.url });
    } catch (error) {
        console.error('Stripe checkout error:', error);
        res.status(500).json({ error: 'Failed to create checkout session' });
    }
});

// Stripe webhook handler
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    
    // Handle the event
    switch (event.type) {
        case 'checkout.session.completed': {
            const session = event.data.object;
            const userId = session.metadata.userId;
            const planId = session.metadata.plan;
            
            console.log(`✅ Payment completed for user ${userId}, plan: ${planId}`);
            
            // Update user subscription status in database
            if (mongoose.connection.readyState === 1) {
                await User.findByIdAndUpdate(userId, {
                    subscription: {
                        plan: planId,
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
            console.log(`❌ Subscription cancelled: ${subscription.id}`);
            
            // Update user to no longer have active subscription
            if (mongoose.connection.readyState === 1) {
                await User.findOneAndUpdate(
                    { 'subscription.stripeSubscriptionId': subscription.id },
                    { 'subscription.status': 'cancelled' }
                );
            }
            break;
        }
        
        default:
            console.log(`Unhandled event type: ${event.type}`);
    }
    
    res.json({ received: true });
});

// Get user subscription status
app.get('/api/user/subscription', authenticateToken, async (req, res) => {
    const userId = req.user.id || req.userId;
    
    try {
        if (mongoose.connection.readyState === 1) {
            const user = await User.findById(userId).select('subscription');
            res.json({ subscription: user?.subscription || null });
        } else {
            const user = users.get(userId);
            res.json({ subscription: user?.subscription || null });
        }
    } catch (error) {
        console.error('Get subscription error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create customer portal session
app.post('/api/stripe/create-portal-session', authenticateToken, async (req, res) => {
    const userId = req.user.id || req.userId;
    
    if (!stripe) {
        return res.status(500).json({ error: 'Stripe not configured' });
    }
    
    try {
        let stripeCustomerId;
        
        if (mongoose.connection.readyState === 1) {
            const user = await User.findById(userId).select('subscription');
            stripeCustomerId = user?.subscription?.stripeCustomerId;
        } else {
            const user = users.get(userId);
            stripeCustomerId = user?.subscription?.stripeCustomerId;
        }
        
        if (!stripeCustomerId) {
            return res.status(400).json({ error: 'No subscription found' });
        }
        
        const session = await stripe.billingPortal.sessions.create({
            customer: stripeCustomerId,
            return_url: `${FRONTEND_URL}/dashboard.html`
        });
        
        res.json({ url: session.url });
    } catch (error) {
        console.error('Portal session error:', error);
        res.status(500).json({ error: 'Failed to create portal session' });
    }
});

// API: Complete setup (after payment)
app.post('/api/user/complete-setup', authenticateToken, async (req, res) => {
    const { businessName, ownerName, phone, website, services, areas, unique, openingMessage, conversationGoal } = req.body;
    
    try {
        const userId = req.user.id || req.userId;
        
        if (mongoose.connection.readyState === 1) {
            // Use MongoDB
            const user = await User.findByIdAndUpdate(
                userId,
                {
                    businessName,
                    ownerName,
                    phone,
                    website,
                    services,
                    areas,
                    unique,
                    openingMessage,
                    conversationGoal,
                    setupComplete: true
                },
                { new: true }
            );
            
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            
            return res.json({ success: true, user });
        } else {
            // Fallback: use in-memory storage
            const user = users.get(userId);
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            
            user.businessName = businessName;
            user.ownerName = ownerName;
            user.phone = phone;
            user.website = website;
            user.services = services;
            user.areas = areas;
            user.unique = unique;
            user.openingMessage = openingMessage;
            user.conversationGoal = conversationGoal;
            user.setupComplete = true;
            
            users.set(userId, user);
            saveUsers();
            
            res.json({ success: true, user });
        }
    } catch (error) {
        console.error('Setup error:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: Get user config
app.get('/api/user/:id', authenticateToken, (req, res) => {
    const user = users.get(req.params.id);
    
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
        id: user.id,
        email: user.email,
        businessName: user.businessName,
        config: user.config,
        createdAt: user.createdAt
    });
});

// API: Update user config
app.put('/api/user/:id/config', authenticateToken, (req, res) => {
    const user = users.get(req.params.id);
    
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    user.config = { ...user.config, ...req.body };
    users.set(user.id, user);
    saveUsers();
    
    res.json({ config: user.config });
});

// API: Get current user
app.get('/api/user/me', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id || req.userId;
        
        if (mongoose.connection.readyState === 1) {
            const user = await User.findById(userId).select('-password -resetToken');
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            return res.json(user);
        } else {
            const user = users.get(userId);
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            const { password, ...userData } = user;
            return res.json(userData);
        }
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: Update profile
app.put('/api/user/profile', authenticateToken, async (req, res) => {
    const { businessName, ownerName, phone, website, services } = req.body;
    
    try {
        const userId = req.user.id || req.userId;
        
        if (mongoose.connection.readyState === 1) {
            const user = await User.findByIdAndUpdate(userId, {
                businessName, ownerName, phone, website, services
            }, { new: true }).select('-password -resetToken');
            
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            return res.json(user);
        } else {
            const user = users.get(userId);
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            
            Object.assign(user, { businessName, ownerName, phone, website, services });
            users.set(userId, user);
            saveUsers();
            
            const { password, ...userData } = user;
            return res.json(userData);
        }
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: Change password
app.post('/api/user/change-password', authenticateToken, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Current and new password required' });
    }
    
    try {
        const userId = req.user.id || req.userId;
        
        if (mongoose.connection.readyState === 1) {
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            
            const validPassword = await bcrypt.compare(currentPassword, user.password);
            if (!validPassword) {
                return res.status(401).json({ error: 'Current password is incorrect' });
            }
            
            user.password = await bcrypt.hash(newPassword, 10);
            await user.save();
            
            return res.json({ message: 'Password updated successfully' });
        } else {
            const user = users.get(userId);
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            
            if (user.password !== currentPassword) {
                return res.status(401).json({ error: 'Current password is incorrect' });
            }
            
            user.password = newPassword;
            users.set(userId, user);
            saveUsers();
            
            return res.json({ message: 'Password updated successfully' });
        }
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: Delete account
app.delete('/api/user/delete', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id || req.userId;
        
        if (mongoose.connection.readyState === 1) {
            await User.findByIdAndDelete(userId);
            await KnowledgeBase.deleteMany({ userId });
            await FlaggedQuestion.deleteMany({ userId });
        } else {
            users.delete(userId);
            saveUsers();
            
            // Delete chat history
            const historyPath = path.join(DATA_DIR, `chat_${userId}.json`);
            if (fs.existsSync(historyPath)) {
                fs.unlinkSync(historyPath);
            }
        }
        
        res.json({ message: 'Account deleted successfully' });
    } catch (error) {
        console.error('Delete account error:', error);
        res.status(500).json({ error: error.message });
    }
});

// =======================
// CHAT API
// =======================

// Get chat history file path for user
function getHistoryPath(userId) {
    return path.join(DATA_DIR, `chat_${userId}.json`);
}

// Load chat history
function loadChatHistory(userId) {
    try {
        const filePath = getHistoryPath(userId);
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) {
        console.error('Error loading chat history:', e);
    }
    return [];
}

// Save chat history
function saveChatHistory(userId, history) {
    try {
        fs.writeFileSync(getHistoryPath(userId), JSON.stringify(history, null, 2));
    } catch (e) {
        console.error('Error saving chat history:', e);
    }
}

// Smart fallback responses when AI is unavailable
function getSmartFallback(businessInfo, userMessage) {
    const msg = userMessage.toLowerCase();
    const businessName = (businessInfo?.name || '').toLowerCase();
    const isTheLeadChat = businessName.includes('leadchat') || businessName.includes('the lead');
    
    // TheLeadChat-specific responses (Mick's SaaS business)
    if (isTheLeadChat) {
        const theleadchatPatterns = [
            { keywords: ['price', 'cost', 'how much', 'charge', 'fee', 'pricing'], response: `We have two plans: Starter at $29/month (1 phone number, 100 AI responses/month, basic widget) and Professional at $79/month (3 phone numbers, unlimited AI, calendar integration, priority support). Which one interests you?` },
            { keywords: ['sign up', 'register', 'signup', 'get started', 'create account'], response: `You can sign up right now at theleadchat.com! Just click 'Get Started', enter your email and business name, and you'll be up and running in minutes. Want me to send you the link?` },
            { keywords: ['what do you do', 'what is', 'how does it work', 'services'], response: `TheLeadChat is an AI receptionist that never misses a lead! When customers call or text your business, we answer immediately with AI, capture their info, answer questions, and can even book appointments - 24/7!` },
            { keywords: ['phone number', 'toll free', 'get a number', 'own number'], response: `When you sign up, we automatically provision a toll-free phone number for your business. Your customers call and text that number and our AI handles everything!` },
            { keywords: ['missed call', 'miss you', 'if i miss'], response: `No worries! If you miss a call, our AI immediately texts the caller back letting them know you'll get back to soon. You'll also get a notification with all their details.` },
            { keywords: ['free trial', 'trial', 'free'], response: `Yes! We offer a 7-day free trial so you can test everything out. No credit card required to start. Just go to theleadchat.com and click 'Get Started'!` },
            { keywords: ['demo', 'see it', 'how does it look'], response: `I'd love to show you! You can see it in action at theleadchat.com or I can schedule a quick demo call. What works best for you?` },
            { keywords: ['contact', 'speak to someone', 'talk to', 'manager'], response: `I can help you get started! If you'd prefer to talk to someone, just let me know your phone number and the best time to reach you.` }
        ];
        
        for (const p of theleadchatPatterns) {
            if (p.keywords.some(k => msg.includes(k))) {
                return p.response;
            }
        }
    }
    
    // Default business patterns
    const defaultPatterns = [
        { keywords: ['price', 'cost', 'how much', 'charge', 'fee'], response: `Great question! Our pricing varies based on your needs. For a personalized quote, I'd recommend speaking with our team directly. Would you like us to call you?` },
        { keywords: ['book', 'schedule', 'appointment', 'meeting', 'consultation'], response: `I'd be happy to help you schedule something! We offer flexible times including evenings and weekends. What's works best for you - a quick call or an in-person meeting?` },
        { keywords: ['service', 'services', 'offer', 'what do you do'], response: `We offer a range of services to help businesses like yours. From lead capture to customer support automation, we'd love to learn more about your needs. What challenge are you trying to solve?` },
        { keywords: ['contact', 'phone', 'call', 'email', 'reach', 'address'], response: `You can reach us by phone, email, or through this chat! For the fastest response, give us a call. Would you like me to have someone contact you directly?` },
        { keywords: ['hour', 'hours', 'open', 'time', 'when'], response: `We're here to help! Our standard hours are Monday-Friday, 9-6. But we understand business never sleeps - feel free to leave a message and we'll get back to you ASAP!` },
        { keywords: ['help', 'need', 'want', 'looking for'], response: `I'd love to help! To better understand what you need, could you tell me a bit more about what you're looking for?` },
        { keywords: ['thank', 'thanks', 'great', 'awesome', 'nice'], response: `You're welcome! Is there anything else I can help you with?` },
        { keywords: ['bye', 'goodbye', 'later'], response: `Thanks for chatting with us! Feel free to come back anytime. Have a great day!` }
    ];
    
    // Find matching pattern
    for (const p of defaultPatterns) {
        if (p.keywords.some(k => msg.includes(k))) {
            return p.response;
        }
    }
    
    // Default response
    return `Thanks for reaching out! I'm here to help. Could you tell me more about what you're looking for? I can help with questions about our services, pricing, scheduling, or anything else you need!`;
}

// Generate AI response using MiniMax (reusable function)
async function getMiniMaxResponse(businessInfo, userMessage, knowledgeBase = []) {
    const minimaxKey = process.env.MINIMAX_API_KEY;
    
    if (!minimaxKey) {
        console.log('No MiniMax API key, using fallback');
        return getSmartFallback(businessInfo, userMessage);
    }
    
    // Build knowledge base context
    const knowledgeContext = knowledgeBase.length > 0 
        ? `\n\nUse these Q&A pairs to answer questions when relevant:\n${knowledgeBase.map(kb => `Q: ${kb.question}\nA: ${kb.answer}`).join('\n\n')}`
        : '';
    
    // Check if this is TheLeadChat
    const isTheLeadChat = (businessInfo.name || '').toLowerCase().includes('leadchat');
    
    // Add specific info for TheLeadChat
    let theleadchatInfo = '';
    if (isTheLeadChat) {
        theleadchatInfo = `
IMPORTANT - You represent TheLeadChat SaaS:
- Pricing: Starter $29/mo (1 phone#, 100 AI responses), Professional $79/mo (3 phone#, unlimited AI, calendar)
- Sign up at theleadchat.com
- It's an AI receptionist that never misses leads - answers calls/texts 24/7
- Automatically texts back missed calls
- Can answer questions about the service, pricing, and sign up process
- Always encourage sign up or demo!`;
    }
    
    const systemPrompt = `You are a helpful AI assistant for ${businessInfo.name}.
Business Services: ${businessInfo.services || 'general services'}
Service Areas: ${businessInfo.areas || 'all areas'}
What Makes Us Unique: ${businessInfo.unique || 'quality service'}
${theleadchatInfo}
${knowledgeContext}

Be friendly, professional, and concise. Help customers with their questions. If asked about pricing, give the actual prices. If asked to book, offer to schedule or provide calendly link if available.`;

    try {
        const response = await axios.post('https://api.minimax.chat/v1/text/chatcompletion_v2', {
            model: 'abab6.5s-chat',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage }
            ]
        }, {
            headers: {
                'Authorization': `Bearer ${minimaxKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });
        
        if (response.data.base_resp && response.data.base_resp.status_code !== 0) {
            throw new Error(`MiniMax API error: ${response.data.base_resp.status_msg || 'Unknown error'}`);
        }
        
        return response.data.choices?.[0]?.message?.content || response.data.reply || getSmartFallback(businessInfo, userMessage);
        
    } catch (error) {
        console.error('MiniMax error:', error.message);
        return getSmartFallback(businessInfo, userMessage);
    }
}

// API: Send chat message
app.post('/api/chat', authenticateToken, async (req, res) => {
    const { message, history = [], business, model } = req.body;
    
    if (!message) {
        return res.status(400).json({ error: 'Message required' });
    }
    
    // Get user's business info
    const user = users.get(req.userId);
    const businessInfo = business || (user?.businessName || 'My Business');
    
    // Load user's knowledge base
    let knowledgeBase = [];
    try {
        if (mongoose.connection.readyState === 1) {
            knowledgeBase = await KnowledgeBase.find({ userId: req.userId });
        } else {
            knowledgeBase = loadKnowledge(req.userId);
        }
    } catch (e) {
        console.error('Error loading knowledge base:', e);
    }
    
    // Build knowledge base context
    const knowledgeContext = knowledgeBase.length > 0 
        ? `\n\nUse these Q&A pairs to answer questions when relevant:\n${knowledgeBase.map(kb => `Q: ${kb.question}\nA: ${kb.answer}`).join('\n\n')}`
        : '';
    
    // Build system prompt with knowledge base
    const systemPrompt = `You are a helpful AI assistant for ${businessInfo}.
Be friendly, professional, and concise. Help customers with their questions.${knowledgeContext}`;
    
    // Check if question might be answerable by knowledge base
    const lowerMessage = message.toLowerCase();
    let foundAnswer = null;
    
    for (const kb of knowledgeBase) {
        const kbQuestion = kb.question.toLowerCase();
        const keywords = kbQuestion.split(' ').filter(w => w.length > 3);
        const matchCount = keywords.filter(k => lowerMessage.includes(k)).length;
        
        if (matchCount >= 2 || kbQuestion.includes(lowerMessage.substring(0, 10))) {
            foundAnswer = kb.answer;
            break;
        }
    }
    
    // If we found a match in knowledge base, use it directly
    if (foundAnswer) {
        const newHistory = [
            ...history,
            { role: 'user', content: message },
            { role: 'assistant', content: foundAnswer }
        ];
        
        if (newHistory.length > 50) {
            newHistory.splice(0, newHistory.length - 50);
        }
        
        saveChatHistory(req.userId, newHistory);
        
        return res.json({ 
            response: foundAnswer,
            history: newHistory,
            fromKnowledgeBase: true
        });
    }
    
    // Prepare messages for AI
    const messages = [
        { role: 'system', content: systemPrompt },
        ...history.slice(-10).map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content: message }
    ];
    
    try {
        // Call MiniMax API
        const minimaxKey = process.env.MINIMAX_API_KEY;
        console.log('Using API key:', minimaxKey ? 'Key loaded' : 'NO KEY');
        
        const response = await axios.post('https://api.minimax.chat/v1/text/chatcompletion_v2', {
            model: 'abab6.5s-chat',
            messages: messages
        }, {
            headers: {
                'Authorization': `Bearer ${minimaxKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });
        
        console.log('MiniMax response:', JSON.stringify(response.data, null, 2));
        
        // Check for API errors in response
        if (response.data.base_resp && response.data.base_resp.status_code !== 0) {
            throw new Error(`MiniMax API error: ${response.data.base_resp.status_msg || 'Unknown error'}`);
        }
        
        let aiResponse = response.data.choices?.[0]?.message?.content || response.data.reply || 'No response';
        
        // Check if AI is unsure (low confidence responses)
        const unsurePhrases = ["i'm not sure", "i don't know", "i cannot find", "no information", "don't have that information"];
        const isUnsure = unsurePhrases.some(phrase => aiResponse.toLowerCase().includes(phrase));
        
        // Flag unknown questions for review
        if (isUnsure && knowledgeBase.length > 0) {
            try {
                const flagData = {
                    userId: req.userId,
                    question: message,
                    conversationId: null
                };
                
                if (mongoose.connection.readyState === 1) {
                    const flagged = new FlaggedQuestion(flagData);
                    await flagged.save();
                } else {
                    let flagged = loadFlagged(req.userId);
                    flagged.push({
                        id: 'flag_' + Date.now(),
                        ...flagData,
                        flaggedAt: new Date().toISOString(),
                        resolved: false
                    });
                    saveFlagged(req.userId, flagged);
                }
                
                console.log('Flagged unknown question for review:', message);
            } catch (flagError) {
                console.error('Error flagging question:', flagError);
            }
        }
        
        // Save to history
        const newHistory = [
            ...history,
            { role: 'user', content: message },
            { role: 'assistant', content: aiResponse }
        ];
        
        // Keep only last 50 messages
        if (newHistory.length > 50) {
            newHistory.splice(0, newHistory.length - 50);
        }
        
        saveChatHistory(req.userId, newHistory);
        
        res.json({ 
            response: aiResponse,
            history: newHistory,
            flagged: isUnsure && knowledgeBase.length > 0
        });
        
    } catch (error) {
        console.error('MiniMax error:', error.message);
        
        // Fallback to Ollama if MiniMax fails
        try {
            console.log('Falling back to Ollama...');
            const ollamaResponse = await axios.post(`${OLLAMA_URL}/api/chat`, {
                model: 'qwen3-coder:30b',
                messages: messages,
                stream: false
            });
            
            let aiResponse = ollamaResponse.data.message.content;
            console.log('Ollama response:', aiResponse);
            
            // Save to history
            const newHistory = [
                ...history,
                { role: 'user', content: message },
                { role: 'assistant', content: aiResponse }
            ];
            
            if (newHistory.length > 50) {
                newHistory.splice(0, newHistory.length - 50);
            }
            
            saveChatHistory(req.userId, newHistory);
            
            return res.json({ 
                response: aiResponse,
                history: newHistory,
                flagged: false,
                source: 'ollama'
            });
            
        } catch (ollamaError) {
            console.error('Ollama fallback error:', ollamaError.message);
            
            // Try OpenRouter as second fallback (free models!)
            try {
                console.log('Trying OpenRouter (free tier)...');
                const openrouterResponse = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
                    model: 'google/gemma-3n-e4b', // Free model
                    messages: messages,
                    max_tokens: 500
                }, {
                    headers: {
                        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY || 'free'}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': FRONTEND_URL,
                        'X-Title': 'TheLeadChat'
                    },
                    timeout: 30000
                });
                
                let aiResponse = openrouterResponse.data.choices[0].message.content;
                console.log('OpenRouter response:', aiResponse);
                
                const newHistory = [
                    ...history,
                    { role: 'user', content: message },
                    { role: 'assistant', content: aiResponse }
                ];
                
                if (newHistory.length > 50) {
                    newHistory.splice(0, newHistory.length - 50);
                }
                
                saveChatHistory(req.userId, newHistory);
                
                return res.json({ 
                    response: aiResponse,
                    history: newHistory,
                    flagged: false,
                    source: 'openrouter'
                });
                
            } catch (openrouterError) {
                console.error('OpenRouter error:', openrouterError.message);
                
                // Final fallback: use smart responses
                console.log('Using smart fallback responses');
                const fallbackResponse = getSmartFallback(businessInfo, message);
                
                const newHistory = [
                    ...history,
                    { role: 'user', content: message },
                    { role: 'assistant', content: fallbackResponse }
                ];
                
                if (newHistory.length > 50) {
                    newHistory.splice(0, newHistory.length - 50);
                }
                
                saveChatHistory(req.userId, newHistory);
                
                return res.json({ 
                    response: fallbackResponse,
                    history: newHistory,
                    flagged: false,
                    source: 'smart-fallback'
                });
            }
        }
    }
});

// API: Get chat history
app.get('/api/chat/history', authenticateToken, (req, res) => {
    const history = loadChatHistory(req.userId);
    res.json({ history });
});

// API: Clear chat history
app.delete('/api/chat/history', authenticateToken, (req, res) => {
    saveChatHistory(req.userId, []);
    res.json({ success: true });
});

// =======================
// OLLAMA PROXY
// =======================

// Simple test endpoint (no auth)
app.post('/api/test/chat', async (req, res) => {
    const { message } = req.body;
    
    if (!message) {
        return res.status(400).json({ error: 'Message required' });
    }
    
    try {
        const response = await axios.post(`${OLLAMA_URL}/api/chat`, {
            model: 'qwen3-coder:30b',
            messages: [{ role: 'user', content: message }],
            stream: false
        });
        
        const aiResponse = response.data.message.content;
        res.json({ response: aiResponse });
    } catch (error) {
        console.error('Test chat error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Proxy to Ollama (for direct widget connections)
app.post('/api/ollama/chat', async (req, res) => {
    try {
        const response = await axios.post(`${OLLAMA_URL}/api/chat`, req.body, {
            timeout: 60000,
            responseType: 'stream'
        });
        
        res.setHeader('Content-Type', 'application/json');
        response.data.pipe(res);
    } catch (error) {
        console.error('Ollama proxy error:', error.message);
        res.status(500).json({ error: 'Failed to connect to AI service' });
    }
});

// Check Ollama status
app.get('/api/ollama/status', async (req, res) => {
    try {
        const response = await axios.get(`${OLLAMA_URL}/api/tags`);
        res.json({ 
            status: 'online', 
            models: response.data.models 
        });
    } catch (error) {
        res.json({ 
            status: 'offline', 
            error: error.message 
        });
    }
});

// =======================
// TWILIO WEBHOOK (Phone Auto-Reply)
// =======================

// Twilio credentials from environment
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

// Store leads
const LEADS_FILE = path.join(DATA_DIR, 'leads.json');
function loadLeads() {
    try {
        if (fs.existsSync(LEADS_FILE)) {
            return JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
        }
    } catch (e) {}
    return [];
}

function saveLeads(leads) {
    fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
}

// API: Twilio webhook for incoming SMS
app.post('/api/webhook/twilio', express.urlencoded({ extended: false }), async (req, res) => {
    const { From, Body } = req.body;
    
    console.log(`Incoming SMS from ${From}: ${Body}`);
    
    // Find or create lead
    let leads = loadLeads();
    let lead = leads.find(l => l.phone === From);
    
    if (!lead) {
        lead = {
            id: 'lead_' + Date.now(),
            phone: From,
            source: 'sms',
            createdAt: new Date().toISOString(),
            messages: [],
            converted: false
        };
        leads.push(lead);
    }
    
    // Save user's message
    lead.messages.push({
        role: 'user',
        content: Body,
        timestamp: new Date().toISOString()
    });
    
    // Generate AI response
    let aiResponse;
    try {
        const systemPrompt = `You are a helpful assistant for a business. 
Be friendly and professional. Help the customer with their inquiry.`;
        
        const response = await axios.post(`${OLLAMA_URL}/api/chat`, {
            model: 'qwen3-coder:30b',
            messages: [
                { role: 'system', content: systemPrompt },
                ...lead.messages.slice(-10)
            ],
            stream: false
        });
        
        aiResponse = response.data.message.content;
    } catch (error) {
        aiResponse = "Thanks for your message! We'll get back to you shortly.";
    }
    
    // Save AI response
    lead.messages.push({
        role: 'assistant',
        content: aiResponse,
        timestamp: new Date().toISOString()
    });
    
    saveLeads(leads);
    
    // Return TwiML response
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>${aiResponse}</Message>
</Response>`);
});

// Handle missed calls - send auto-SMS
app.post('/api/webhook/twilio/missed-call', express.urlencoded({ extended: false }), async (req, res) => {
    const from = req.body.From || '';  // The lead's phone number
    const to = req.body.To || '';       // The business's Twilio number
    
    console.log(`📞 Missed call from ${from} to ${to}`);
    
    let businessInfo = null;
    let userId = null;
    
    // Find the user/business by their Twilio number
    try {
        if (mongoose.connection.readyState === 1) {
            const user = await User.findOne({ twilioNumber: to });
            if (user) {
                userId = user._id.toString();
                businessInfo = {
                    name: user.businessName || 'We',
                    services: user.services || '',
                    unique: user.unique || '',
                    openingMessage: user.openingMessage || '',
                    calendlyLink: user.calendlyLink || ''
                };
                console.log(`📱 Found business: ${user.businessName}`);
            }
        }
    } catch (e) {
        console.error('Error finding user:', e.message);
    }
    
    // Build personalized auto-reply message
    let autoReplyMessage;
    if (businessInfo && businessInfo.openingMessage) {
        autoReplyMessage = businessInfo.openingMessage;
    } else if (businessInfo) {
        autoReplyMessage = `Hi! Thanks for calling ${businessInfo.name}. We missed your call but we're here to help! ${businessInfo.services ? `We offer: ${businessInfo.services}` : ''} Reply to this message or visit our website.`;
    } else {
        autoReplyMessage = "Hi! Thanks for calling. We missed your call but we're here to help! Reply to this message or visit our website.";
    }
    
    // Send auto-reply SMS using Twilio
    const twilio = getTwilioClient();
    if (twilio && to) {
        try {
            await twilio.messages.create({
                body: autoReplyMessage,
                from: to,  // Send from the BUSINESS's number
                to: from   // Send TO the lead
            });
            
            console.log(`✅ Auto-SMS sent to ${from}: ${autoReplyMessage.substring(0, 50)}...`);
        } catch (error) {
            console.error('Twilio SMS error:', error.message);
        }
    }
    
    // Return TwiML to play a message to the caller
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Thanks for calling! We've sent you a text message. We'll get back to you shortly.</Say>
</Response>`);
});

// API: Get all leads
app.get('/api/leads', authenticateToken, (req, res) => {
    const leads = loadLeads();
    res.json({ leads });
});

// API: Mark lead as converted
app.put('/api/leads/:id/convert', authenticateToken, (req, res) => {
    let leads = loadLeads();
    const lead = leads.find(l => l.id === req.params.id);
    
    if (lead) {
        lead.converted = true;
        lead.convertedAt = new Date().toISOString();
        saveLeads(leads);
    }
    
    res.json({ success: true, lead });
});

// =======================
// CALENDAR BOOKING
// =======================

// Simple availability store (in production, use Google Calendar API)
const BOOKINGS_FILE = path.join(DATA_DIR, 'bookings.json');
function loadBookings() {
    try {
        if (fs.existsSync(BOOKINGS_FILE)) {
            return JSON.parse(fs.readFileSync(BOOKINGS_FILE, 'utf8'));
        }
    } catch (e) {}
    return [];
}

function saveBookings(bookings) {
    fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(bookings, null, 2));
}

// API: Check availability
app.get('/api/calendar/availability', (req, res) => {
    const { date } = req.query;
    
    // Return mock availability
    const slots = [
        '09:00', '10:00', '11:00', '14:00', '15:00', '16:00'
    ];
    
    // Filter out booked slots
    const bookings = loadBookings();
    const bookedSlots = bookings
        .filter(b => b.date === date)
        .map(b => b.time);
    
    const available = slots.filter(s => !bookedSlots.includes(s));
    
    res.json({ date, slots: available });
});

// API: Book appointment
app.post('/api/calendar/book', authenticateToken, (req, res) => {
    const { date, time, name, email, phone, notes } = req.body;
    
    if (!date || !time || !name || !email) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const bookings = loadBookings();
    
    // Check if slot is already booked
    if (bookings.some(b => b.date === date && b.time === time)) {
        return res.status(400).json({ error: 'Time slot not available' });
    }
    
    const booking = {
        id: 'booking_' + Date.now(),
        userId: req.userId,
        date,
        time,
        name,
        email,
        phone,
        notes,
        status: 'confirmed',
        createdAt: new Date().toISOString()
    };
    
    bookings.push(booking);
    saveBookings(bookings);
    
    // In production, send confirmation email
    
    res.json({ 
        success: true, 
        booking,
        message: 'Appointment booked successfully!'
    });
});

// API: Get user's bookings
app.get('/api/calendar/bookings', authenticateToken, (req, res) => {
    const bookings = loadBookings().filter(b => b.userId === req.userId);
    res.json({ bookings });
});

// =======================
// KNOWLEDGE BASE API (Train Your AI)
// =======================

// Get file path for knowledge base (fallback)
function getKnowledgePath(userId) {
    return path.join(DATA_DIR, `knowledge_${userId}.json`);
}

// Get file path for flagged questions (fallback)
function getFlaggedPath(userId) {
    return path.join(DATA_DIR, `flagged_${userId}.json`);
}

// Load knowledge base from file (fallback)
function loadKnowledge(userId) {
    try {
        const filePath = getKnowledgePath(userId);
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) {}
    return [];
}

// Save knowledge base to file (fallback)
function saveKnowledge(userId, knowledge) {
    try {
        fs.writeFileSync(getKnowledgePath(userId), JSON.stringify(knowledge, null, 2));
    } catch (e) {
        console.error('Error saving knowledge:', e);
    }
}

// Load flagged questions from file (fallback)
function loadFlagged(userId) {
    try {
        const filePath = getFlaggedPath(userId);
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) {}
    return [];
}

// Save flagged questions to file (fallback)
function saveFlagged(userId, flagged) {
    try {
        fs.writeFileSync(getFlaggedPath(userId), JSON.stringify(flagged, null, 2));
    } catch (e) {
        console.error('Error saving flagged:', e);
    }
}

// API: Add Q&A pair to knowledge base
app.post('/api/knowledge/qa', authenticateToken, async (req, res) => {
    const { question, answer } = req.body;
    
    if (!question || !answer) {
        return res.status(400).json({ error: 'Question and answer are required' });
    }
    
    const userId = req.userId;
    
    try {
        // Check MongoDB connection
        if (mongoose.connection.readyState === 1) {
            const qa = new KnowledgeBase({ userId, question, answer });
            await qa.save();
            return res.json({ success: true, qa });
        } else {
            // Fallback: use file storage
            const knowledge = loadKnowledge(userId);
            const qa = {
                id: 'qa_' + Date.now(),
                userId,
                question,
                answer,
                createdAt: new Date().toISOString()
            };
            knowledge.push(qa);
            saveKnowledge(userId, knowledge);
            return res.json({ success: true, qa });
        }
    } catch (error) {
        console.error('Error saving Q&A:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: Get all Q&A pairs for user
app.get('/api/knowledge/qa', authenticateToken, async (req, res) => {
    const userId = req.userId;
    
    try {
        if (mongoose.connection.readyState === 1) {
            const qa = await KnowledgeBase.find({ userId }).sort({ createdAt: -1 });
            return res.json({ qa });
        } else {
            // Fallback: use file storage
            const knowledge = loadKnowledge(userId);
            return res.json({ qa: knowledge });
        }
    } catch (error) {
        console.error('Error getting Q&A:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: Delete Q&A pair
app.delete('/api/knowledge/qa/:id', authenticateToken, async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;
    
    try {
        if (mongoose.connection.readyState === 1) {
            await KnowledgeBase.findOneAndDelete({ _id: id, userId });
            return res.json({ success: true });
        } else {
            // Fallback: use file storage
            let knowledge = loadKnowledge(userId);
            knowledge = knowledge.filter(q => q.id !== id);
            saveKnowledge(userId, knowledge);
            return res.json({ success: true });
        }
    } catch (error) {
        console.error('Error deleting Q&A:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: Get flagged questions
app.get('/api/knowledge/flagged', authenticateToken, async (req, res) => {
    const userId = req.userId;
    
    try {
        if (mongoose.connection.readyState === 1) {
            const flagged = await FlaggedQuestion.find({ userId, resolved: false }).sort({ flaggedAt: -1 });
            return res.json({ flagged });
        } else {
            // Fallback: use file storage
            const flagged = loadFlagged(userId).filter(f => !f.resolved);
            return res.json({ flagged });
        }
    } catch (error) {
        console.error('Error getting flagged:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: Answer a flagged question (adds to knowledge base and marks resolved)
app.post('/api/knowledge/flagged/:id/answer', authenticateToken, async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;
    const { answer } = req.body;
    
    if (!answer) {
        return res.status(400).json({ error: 'Answer is required' });
    }
    
    try {
        if (mongoose.connection.readyState === 1) {
            // Find the flagged question
            const flagged = await FlaggedQuestion.findOne({ _id: id, userId });
            if (!flagged) {
                return res.status(404).json({ error: 'Flagged question not found' });
            }
            
            // Add to knowledge base
            const qa = new KnowledgeBase({ 
                userId, 
                question: flagged.question, 
                answer 
            });
            await qa.save();
            
            // Mark flagged as resolved
            flagged.resolved = true;
            flagged.answer = answer;
            flagged.resolvedAt = new Date();
            await flagged.save();
            
            return res.json({ success: true, qa });
        } else {
            // Fallback: use file storage
            let flagged = loadFlagged(userId);
            const flaggedItem = flagged.find(f => f.id === id);
            
            if (!flaggedItem) {
                return res.status(404).json({ error: 'Flagged question not found' });
            }
            
            // Add to knowledge base
            const qa = {
                id: 'qa_' + Date.now(),
                userId,
                question: flaggedItem.question,
                answer,
                createdAt: new Date().toISOString()
            };
            const knowledge = loadKnowledge(userId);
            knowledge.push(qa);
            saveKnowledge(userId, knowledge);
            
            // Mark flagged as resolved
            flaggedItem.resolved = true;
            flaggedItem.answer = answer;
            flaggedItem.resolvedAt = new Date().toISOString();
            saveFlagged(userId, flagged);
            
            return res.json({ success: true, qa });
        }
    } catch (error) {
        console.error('Error answering flagged:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: Delete flagged question without answering
app.delete('/api/knowledge/flagged/:id', authenticateToken, async (req, res) => {
    const userId = req.userId;
    const { id } = req.params;
    
    try {
        if (mongoose.connection.readyState === 1) {
            await FlaggedQuestion.findOneAndDelete({ _id: id, userId });
            return res.json({ success: true });
        } else {
            // Fallback: use file storage
            let flagged = loadFlagged(userId);
            flagged = flagged.filter(f => f.id !== id);
            saveFlagged(userId, flagged);
            return res.json({ success: true });
        }
    } catch (error) {
        console.error('Error deleting flagged:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: Flag a question for review (called by AI when it can't answer)
app.post('/api/knowledge/flag', authenticateToken, async (req, res) => {
    const userId = req.userId;
    const { question, conversationId } = req.body;
    
    if (!question) {
        return res.status(400).json({ error: 'Question is required' });
    }
    
    try {
        if (mongoose.connection.readyState === 1) {
            const flagged = new FlaggedQuestion({ userId, question, conversationId });
            await flagged.save();
            return res.json({ success: true, flagged });
        } else {
            // Fallback: use file storage
            const flagged = loadFlagged(userId);
            const newFlagged = {
                id: 'flag_' + Date.now(),
                userId,
                question,
                conversationId,
                flaggedAt: new Date().toISOString(),
                resolved: false
            };
            flagged.push(newFlagged);
            saveFlagged(userId, flagged);
            return res.json({ success: true, flagged: newFlagged });
        }
    } catch (error) {
        console.error('Error flagging question:', error);
        res.status(500).json({ error: error.message });
    }
});

// =======================
// WIDGET EMBED CODE
// =======================

// API: Get embed code for user
app.get('/api/embed/:userId', (req, res) => {
    const user = users.get(req.params.userId);
    
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    const serverUrl = req.protocol + '://' + req.get('host');
    const embedCode = `<script src="${serverUrl}/chatbot-widget.js" data-api="${serverUrl}" data-business="${user.businessName}" data-theme="${user.config.theme}" data-color="${user.config.primaryColor}"></script>`;
    
    res.json({
        embedCode,
        config: {
            apiUrl: serverUrl,
            businessName: user.businessName,
            theme: user.config.theme,
            primaryColor: user.config.primaryColor
        }
    });
});

// =======================
// GHL PROXY (CORS fix)
// =======================

const GHL_TOKEN = 'pit-c65cd4a9-339b-47ce-9b49-ae2544dff5a6';
const GHL_LOCATION = '3KVfdheUzSpGf4rO6mqP';
const GHL_PIPELINE = 'jNwkT7Vw6buDJExrMYC6';
const GHL_STAGE_NEW = 'f75cb01c-2559-4057-a67e-ab7cc0f8f96d';

app.post('/api/ghl/contact', async (req, res) => {
    try {
        const { firstName, lastName, phone, email, notes } = req.body;
        
        // Create contact
        const contactRes = await axios.post('https://services.leadconnectorhq.com/contacts/', {
            locationId: GHL_LOCATION,
            firstName,
            lastName,
            phone: phone || '',
            email: email || '',
            tags: ['restaurant-lead', 'scraper']
        }, {
            headers: {
                'Authorization': 'Bearer ' + GHL_TOKEN,
                'Version': '2021-07-28',
                'Content-Type': 'application/json'
            }
        });
        
        const contactId = contactRes.data.contact?.id;
        
        if (contactId) {
            // Create opportunity
            const oppRes = await axios.post('https://services.leadconnectorhq.com/opportunities/', {
                name: `${firstName} ${lastName} - Restaurant Lead`,
                locationId: GHL_LOCATION,
                contactId: contactId,
                pipelineId: GHL_PIPELINE,
                pipelineStageId: GHL_STAGE_NEW,
                monetaryValue: 100,
                status: 'open'
            }, {
                headers: {
                    'Authorization': 'Bearer ' + GHL_TOKEN,
                    'Version': '2021-07-28',
                    'Content-Type': 'application/json'
                }
            });
            
            res.json({ success: true, contact: contactRes.data.contact, opportunity: oppRes.data.opportunity });
        } else {
            res.json({ success: false, error: 'Contact already exists' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =======================
// TWILIO ADMIN API (Mick's Twilio Management)
// =======================

// Helper to get Twilio client - reads directly from env
function getTwilioClient() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
        return null;
    }
    const twilio = require('twilio')(accountSid, authToken);
    return twilio;
}

// API: Get Twilio config status
app.get('/api/admin/twilio/status', (req, res) => {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const phoneNumber = process.env.TWILIO_PHONE_NUMBER;
    const connected = !!(accountSid && process.env.TWILIO_AUTH_TOKEN);
    res.json({ 
        connected, 
        accountSid: accountSid ? accountSid.substring(0, 8) + '...' : '',
        hasPhoneNumber: !!phoneNumber
    });
});

// API: Save Twilio credentials (admin only - in production add auth check)
app.post('/api/admin/twilio/config', (req, res) => {
    const { accountSid, authToken, phoneNumber } = req.body;
    
    if (!accountSid || !authToken) {
        return res.status(400).json({ error: 'Account SID and Auth Token required' });
    }
    
    twilioConfig.accountSid = accountSid;
    twilioConfig.authToken = authToken;
    twilioConfig.phoneNumber = phoneNumber || '';
    
    // Test the credentials
    const twilio = getTwilioClient();
    if (!twilio) {
        return res.status(500).json({ error: 'Failed to initialize Twilio client' });
    }
    
    // Verify credentials work
    twilio.api.accounts(twilioConfig.accountSid).fetch()
        .then(() => {
            res.json({ success: true, message: 'Twilio connected successfully!' });
        })
        .catch(err => {
            res.status(400).json({ error: 'Invalid credentials: ' + err.message });
        });
});

// API: Buy a new phone number
app.post('/api/admin/twilio/buy-number', async (req, res) => {
    const { areaCode, friendlyName } = req.body;
    
    const twilio = getTwilioClient();
    if (!twilio) {
        return res.status(400).json({ error: 'Twilio not configured' });
    }
    
    try {
        // Search for available numbers
        const searchParams = {
            areaCode: areaCode || '800',
            capabilities: { sms: true, voice: true }
        };
        
        const availableNumbers = await twilio.availablePhoneNumbers('US').local.list(searchParams);
        
        if (availableNumbers.length === 0) {
            return res.status(400).json({ error: 'No numbers available in that area code' });
        }
        
        // Buy the first available number
        const numberToBuy = availableNumbers[0];
        
        // Only set webhooks if we have a real public URL (not localhost)
        const serverUrl = process.env.SERVER_URL;
        const purchaseOpts = { phoneNumber: numberToBuy.phoneNumber };
        
        if (serverUrl && !serverUrl.includes('localhost')) {
            purchaseOpts.smsUrl = `${serverUrl}/api/webhook/twilio`;
            purchaseOpts.voiceUrl = `${serverUrl}/api/webhook/twilio/missed-call`;
        }
        
        const purchased = await twilio.incomingPhoneNumbers.create(purchaseOpts);
        
        console.log(`Purchased number: ${purchased.phoneNumber}`);
        
        res.json({ 
            success: true, 
            number: purchased.phoneNumber,
            sid: purchased.sid
        });
    } catch (error) {
        console.error('Error buying number:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: List purchased numbers
app.get('/api/admin/twilio/numbers', async (req, res) => {
    const twilio = getTwilioClient();
    if (!twilio) {
        return res.status(400).json({ error: 'Twilio not configured' });
    }
    
    try {
        const numbers = await twilio.incomingPhoneNumbers.list({ limit: 100 });
        res.json({ 
            numbers: numbers.map(n => ({
                sid: n.sid,
                phoneNumber: n.phoneNumber,
                friendlyName: n.friendlyName,
                smsUrl: n.smsUrl,
                voiceUrl: n.voiceUrl
            }))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Send outbound SMS (for marketing to leads)
app.post('/api/admin/twilio/send-sms', async (req, res) => {
    const { to, message } = req.body;
    
    if (!to || !message) {
        return res.status(400).json({ error: 'Phone number and message required' });
    }
    
    const twilio = getTwilioClient();
    if (!twilio) {
        return res.status(400).json({ error: 'Twilio not configured' });
    }
    
    try {
        // Use the marketing toll-free number
        const fromNumber = process.env.TWILIO_NUMBER || '+18889688198';
        
        const result = await twilio.messages.create({
            body: message,
            from: fromNumber,
            to: to
        });
        
        console.log(`📤 Outbound SMS sent to ${to}: ${message.substring(0, 50)}...`);
        res.json({ success: true, sid: result.sid, status: result.status });
    } catch (error) {
        console.error('Error sending SMS:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// API: Release a number
app.delete('/api/admin/twilio/numbers/:sid', async (req, res) => {
    const twilio = getTwilioClient();
    if (!twilio) {
        return res.status(400).json({ error: 'Twilio not configured' });
    }
    
    try {
        await twilio.incomingPhoneNumbers(req.params.sid).remove();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Auto-assign number to user (called when new user signs up)
async function assignPhoneNumberToUser(userId) {
    const twilio = getTwilioClient();
    if (!twilio) {
        console.log('Twilio not configured, skipping number assignment');
        return null;
    }
    
    try {
        // First, check for unassigned numbers in the account
        const numbers = await twilio.incomingPhoneNumbers.list({ limit: 50 });
        const availableNumbers = numbers.filter(n => !n.friendlyName || !n.friendlyName.startsWith('assigned:'));
        
        if (availableNumbers.length > 0) {
            // Use an existing available number
            const number = availableNumbers[0];
            await twilio.incomingPhoneNumbers(number.sid).update({
                friendlyName: `assigned:${userId}`
            });
            console.log(`Assigned existing number ${number.phoneNumber} to user ${userId}`);
            return number.phoneNumber;
        }
        
        // No available numbers - BUY A NEW TOLL-FREE NUMBER
        console.log('No available numbers, purchasing a new toll-free number...');
        
        try {
            // Search for available toll-free numbers
            const tollFreeNumbers = await twilio.availablePhoneNumbers('US').tollFree.list({
                limit: 5,
                capabilities: ['SMS']
            });
            
            if (tollFreeNumbers.length === 0) {
                console.log('No toll-free numbers available');
                return null;
            }
            
            // Buy the first available toll-free number
            const newNumber = tollFreeNumbers[0];
            const purchased = await twilio.incomingPhoneNumbers.create({
                phoneNumberSid: newNumber.sid,
                friendlyName: `assigned:${userId}`,
                smsUrl: `${process.env.SERVER_URL || 'https://theleadchat.onrender.com'}/api/twilio/sms`,
                smsMethod: 'POST'
            });
            
            console.log(`🎉 Purchased new toll-free number ${purchased.phoneNumber} for user ${userId}`);
            return purchased.phoneNumber;
            
        } catch (buyError) {
            console.error('Error buying toll-free number:', buyError.message);
            return null;
        }
        
        console.log(`Assigned number ${number.phoneNumber} to user ${userId}`);
        return number.phoneNumber;
    } catch (error) {
        console.error('Error assigning phone number:', error);
        return null;
    }
}

// =======================
// SERVE FRONTEND
// =======================

// Serve the main app
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Twilio Voice Webhook - Handle incoming calls
app.post('/api/twilio/voice', express.urlencoded({ extended: false }), async (req, res) => {
    const from = req.body.From || '';
    const to = req.body.To || '';  // The business's Twilio number
    
    console.log(`📞 Incoming voice call from ${from} to ${to}`);
    
    let forwardTo = null;
    let businessName = 'us';
    
    // Find the user by their Twilio number and get their forwarding number
    try {
        if (mongoose.connection.readyState === 1) {
            const user = await User.findOne({ twilioNumber: to });
            if (user && user.phone) {
                forwardTo = user.phone;
                businessName = user.businessName || 'us';
                console.log(`📱 Forwarding call for ${businessName} to ${forwardTo}`);
            }
        }
    } catch (e) {
        console.error('Error finding user for call forwarding:', e.message);
    }
    
    // Default to Mick if no user found (TheLeadChat main line)
    if (!forwardTo) {
        forwardTo = '+19802450074';  // Mick's phone - TheLeadChat's main number
        businessName = 'TheLeadChat';
    }
    
    // TwiML response - forward the call
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Joanna-Neural">Thanks for calling ${businessName}! Connecting you now.</Say>
    <Dial>
        <Number>${forwardTo}</Number>
    </Dial>
</Response>`;
    
    res.type('text/xml');
    res.send(twiml);
});

// Twilio SMS Webhook - Handle incoming texts
app.post('/api/twilio/sms', express.urlencoded({ extended: false }), async (req, res) => {
    const from = req.body.From || '';
    const body = req.body.Body || '';
    const to = req.body.To || '';  // This is the client's Twilio number
    
    console.log(`💬 Incoming SMS from ${from} to ${to}: ${body}`);
    
    let businessInfo;
    let userId;
    let knowledgeBase = [];
    
    try {
        // Find the user by their Twilio number
        if (mongoose.connection.readyState === 1) {
            const user = await User.findOne({ twilioNumber: to });
            if (user) {
                userId = user._id.toString();
                businessInfo = {
                    name: user.businessName || 'My Business',
                    services: user.services || '',
                    areas: user.areas || '',
                    unique: user.unique || '',
                    offers: user.offers || '',
                    openingMessage: user.openingMessage || '',
                    conversationGoal: user.conversationGoal || 'answer_questions',
                    calendlyLink: user.calendlyLink || ''
                };
                
                // Load user's knowledge base
                knowledgeBase = await KnowledgeBase.find({ userId: userId });
                console.log(`📱 Routing SMS to user: ${user.businessName} (${knowledgeBase.length} KB entries)`);
            }
        }
        
        // Fallback if user not found
        if (!businessInfo) {
            console.log('User not found, using default');
            businessInfo = {
                name: 'TheLeadChat',
                services: 'AI Receptionist, Lead Capture, Appointment Booking',
                areas: 'Charlotte, NC and surrounding areas',
                unique: '24/7 AI that never misses a lead'
            };
        }
        
        // Try to find answer in knowledge base first
        const lowerMessage = body.toLowerCase();
        let foundAnswer = null;
        
        for (const kb of knowledgeBase) {
            const kbQuestion = kb.question.toLowerCase();
            const keywords = kbQuestion.split(' ').filter(w => w.length > 3);
            const matchCount = keywords.filter(k => lowerMessage.includes(k)).length;
            
            if (matchCount >= 2 || kbQuestion.includes(lowerMessage.substring(0, 10))) {
                foundAnswer = kb.answer;
                break;
            }
        }
        
        let aiResponse;
        if (foundAnswer) {
            aiResponse = foundAnswer;
        } else {
            // Use MiniMax AI for responses
            try {
                aiResponse = await getMiniMaxResponse(businessInfo, body, knowledgeBase);
            } catch (e) {
                console.error('MiniMax error, using fallback:', e.message);
                aiResponse = getSmartFallback(businessInfo, body);
            }
        }
        
        // Send response via Twilio
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>${aiResponse}</Message>
</Response>`;
        
        res.type('text/xml');
        res.send(twiml);
        
    } catch (error) {
        console.error('SMS handling error:', error);
        const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>Thanks for reaching out! We'll get back to you shortly.</Message>
</Response>`;
        res.type('text/xml');
        res.send(errorTwiml);
    }
});

// Serve demo widget page
app.get('/demo', (req, res) => {
    res.sendFile(path.join(__dirname, 'chatbot-demo.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`
🚀 NineM's AI Chatbot Server Running!
   
   Local:    http://localhost:${PORT}
   API:      http://localhost:${PORT}/api
   
   Endpoints:
   - POST /api/chat          - Send message to AI
   - GET  /api/user/:id      - Get user config
   - POST /api/auth/signup   - Create account
   - POST /api/auth/login    - Login
   - POST /api/webhook/twilio - Twilio SMS webhook
   - GET  /api/leads         - Get leads
   - GET  /api/calendar/availability - Check availability
   - POST /api/calendar/book - Book appointment
   - GET  /api/embed/:userId - Get widget embed code
    `);
});

module.exports = app;

