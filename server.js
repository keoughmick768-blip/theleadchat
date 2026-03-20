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

// MongoDB Connection
if (MONGODB_URI) {
    mongoose.connect(MONGODB_URI)
        .then(() => console.log('✅ Connected to MongoDB'))
        .catch(err => console.log('❌ MongoDB connection error:', err.message));
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
            console.log(`🔐 Password reset token for ${email}: ${resetToken}`);
            console.log(`Reset link: http://localhost:3000/reset-password.html?token=${resetToken}`);
            
            return res.json({ message: 'If an account exists, a reset link has been sent' });
        } else {
            // Fallback to in-memory
            for (const [id, user] of users.entries()) {
                if (user.email === email) {
                    user.resetToken = resetToken;
                    user.resetTokenExpiry = resetTokenExpiry;
                    console.log(`🔐 Password reset token for ${email}: ${resetToken}`);
                    console.log(`Reset link: http://localhost:3000/reset-password.html?token=${resetToken}`);
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
            model: 'MiniMax-M2.5',
            messages: messages
        }, {
            headers: {
                'Authorization': `Bearer ${minimaxKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });
        
        console.log('MiniMax response:', JSON.stringify(response.data, null, 2));
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
        
        // Fallback response if MiniMax is unavailable
        res.json({
            response: "I'm currently unavailable. Please check your API configuration.",
            error: 'AI service unavailable'
        });
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
            model: 'qwen2.5:7b',
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
    const { From } = req.body;
    
    console.log(`Missed call from ${From}`);
    
    // Send auto-reply SMS
    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER) {
        try {
            const twilio = require('twilio')(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
            
            await twilio.messages.create({
                body: "Hey! You called. Want to chat? Reply here or visit our website!",
                from: TWILIO_PHONE_NUMBER,
                to: From
            });
            
            console.log(`Auto-SMS sent to ${From}`);
        } catch (error) {
            console.error('Twilio error:', error.message);
        }
    }
    
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>Thanks for calling! We'll text you shortly.</Message>
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
        // Find an unassigned number (we'll use friendlyName to track this)
        const numbers = await twilio.incomingPhoneNumbers.list({ limit: 50 });
        
        // Find a number not already assigned to a user
        // In production, store this mapping in MongoDB
        const availableNumbers = numbers.filter(n => !n.friendlyName || !n.friendlyName.startsWith('assigned:'));
        
        if (availableNumbers.length === 0) {
            console.log('No available phone numbers');
            return null;
        }
        
        // Mark the number as assigned
        const number = availableNumbers[0];
        await twilio.incomingPhoneNumbers(number.sid).update({
            friendlyName: `assigned:${userId}`
        });
        
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

