const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db'); // Import the new database module

const app = express();

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-for-local-dev';

app.use(cors());
app.use(express.json());

// --- API ENDPOINTS ---

app.post('/api/organizers/register', async (req, res) => {
    const { name, email, password, bio } = req.body;
    if (!name || !email || !password) {
        return res.status(400).json({ message: 'Missing required fields.' });
    }
    try {
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);
        const result = await db.query(
            'INSERT INTO organizers (name, email, password_hash, bio) VALUES ($1, $2, $3, $4) RETURNING id, name, email',
            [name, email, password_hash, bio]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('[/api/organizers/register] Error:', err.stack);
        if (err.code === '23505') {
             res.status(409).json({ message: 'Error: This email is already registered.' });
        } else {
             res.status(500).json({ message: 'A server error occurred during registration.' });
        }
    }
});

app.post('/api/organizers/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await db.query('SELECT * FROM organizers WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }
        const organizer = result.rows[0];
        const isMatch = await bcrypt.compare(password, organizer.password_hash);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }
        const token = jwt.sign({ id: organizer.id }, JWT_SECRET, { expiresIn: '1d' });
        res.json({ token, organizerId: organizer.id });
    } catch (err) {
        console.error('[/api/organizers/login] Error:', err.stack);
        res.status(500).json({ message: 'Server error during login.' });
    }
});

const auth = (req, res, next) => {
    const token = req.header('x-auth-token');
    if (!token) {
        return res.status(401).json({ message: 'No token, authorization denied.' });
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.organizerId = decoded.id;
        next();
    } catch (e) {
        res.status(400).json({ message: 'Token is not valid.' });
    }
};

app.get('/api/organizers/:id', async (req, res) => {
    try {
        const result = await db.query('SELECT id, name, email, bio, followers, social_clicks FROM organizers WHERE id = $1', [req.params.id]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error(`[/api/organizers/:id] Error:`, err.stack);
        res.status(500).send('Server Error');
    }
});

app.get('/api/organizers/:id/protests', auth, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM protests WHERE organizer_id = $1 ORDER BY date DESC', [req.organizerId]);
        res.json(result.rows);
    } catch (err) {
        console.error(`[/api/organizers/:id/protests] Error:`, err.stack);
        res.status(500).send('Server Error');
    }
});

app.get('/api/organizers/:id/analytics', auth, async (req, res) => {
     try {
        const followersRes = await db.query('SELECT followers FROM organizers WHERE id = $1', [req.organizerId]);
        const likesRes = await db.query('SELECT SUM(likes) as total_likes FROM protests WHERE organizer_id = $1', [req.organizerId]);
        
        res.json({
            followers: followersRes.rows[0]?.followers || 0,
            total_likes: parseInt(likesRes.rows[0]?.total_likes, 10) || 0,
            social_clicks: 0
        });
    } catch (err) {
        console.error(`[/api/organizers/:id/analytics] Error:`, err.stack);
        res.status(500).send('Server Error');
    }
});

app.post('/api/protests', auth, async (req, res) => {
    const { name, cause, description, location, latitude, longitude, date, time, official_link, tags } = req.body;
    const tagsArray = tags ? tags.split(',').map(tag => tag.trim()) : [];
    try {
        const result = await db.query(
            'INSERT INTO protests (organizer_id, name, cause, description, location, latitude, longitude, date, time, official_link, tags) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *',
            [req.organizerId, name, cause, description, location, latitude, longitude, date, time, official_link, tagsArray]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(`[/api/protests] POST Error:`, err.stack);
        res.status(500).send('Server Error');
    }
});

app.put('/api/protests/:id', auth, async (req, res) => {
    const { name, cause, description, location, latitude, longitude, date, time, official_link, tags } = req.body;
    const tagsArray = tags ? tags.split(',').map(tag => tag.trim()) : [];
    try {
        const result = await db.query(
            'UPDATE protests SET name=$1, cause=$2, description=$3, location=$4, latitude=$5, longitude=$6, date=$7, time=$8, official_link=$9, tags=$10 WHERE id=$11 AND organizer_id=$12 RETURNING *',
            [name, cause, description, location, latitude, longitude, date, time, official_link, tagsArray, req.params.id, req.organizerId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Protest not found or you do not have permission to edit it.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(`[/api/protests/:id] PUT Error:`, err.stack);
        res.status(500).send('Server Error');
    }
});

app.get('/api/protests', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM protests WHERE date >= CURRENT_DATE ORDER BY date, time');
        res.json(result.rows);
    } catch (err) {
        console.error(`[/api/protests] GET Error:`, err.stack);
        res.status(500).send('Server Error');
    }
});

// A simple health check endpoint
app.get('/api', (req, res) => {
  res.send('Protest Tracker API is running.');
});

// --- SERVERLESS WRAPPER FOR VERCEL ---
module.exports = async (req, res) => {
  try {
    await db.ensureDbIsReady();
    app(req, res);
  } catch (error) {
    console.error("Critical error in serverless handler:", error.stack);
    res.status(500).json({ 
        message: "Server failed to initialize.", 
        error: error.message 
    });
  }
};

