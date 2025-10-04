const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

// --- CONFIGURATION ---
// Vercel provides the full, correct connection string. We don't need to add anything to it.
const pool = new Pool({
  connectionString: process.env.PROTEST_URL,
  // Add a timeout to prevent the server from waiting indefinitely if the DB is truly down.
  connectionTimeoutMillis: 15000, 
});

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-for-local-dev';

app.use(cors());
app.use(express.json());

// --- DATABASE INITIALIZATION ---
// A global promise to ensure initialization only runs once.
let initializationPromise = null;

async function initializeDb() {
  let client;
  try {
    console.log("Attempting to connect to the database...");
    client = await pool.connect();
    console.log("Database connection successful. Ensuring tables exist...");

    // Create tables if they don't exist.
    await client.query(`
      CREATE TABLE IF NOT EXISTS organizers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        bio TEXT,
        followers INT DEFAULT 0,
        social_clicks INT DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS protests (
        id SERIAL PRIMARY KEY,
        organizer_id INT REFERENCES organizers(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        cause VARCHAR(255),
        description TEXT,
        location VARCHAR(255),
        latitude NUMERIC(10, 7),
        longitude NUMERIC(10, 7),
        date DATE NOT NULL,
        time TIME NOT NULL,
        official_link VARCHAR(255),
        tags TEXT[],
        likes INT DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Database initialization complete. The server is ready to accept requests.');
  } catch (err) {
    console.error('FATAL: Database initialization failed.', err.stack);
    throw new Error(`Database initialization failed: ${err.message}`);
  } finally {
    if (client) {
      client.release();
    }
  }
}

// --- API ENDPOINTS ---

app.post('/api/organizers/register', async (req, res) => {
    const { name, email, password, bio } = req.body;
    if (!name || !email || !password) {
        return res.status(400).json({ message: 'Missing required fields.' });
    }
    try {
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);
        const result = await pool.query(
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
        const result = await pool.query('SELECT * FROM organizers WHERE email = $1', [email]);
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
        const result = await pool.query('SELECT id, name, email, bio, followers, social_clicks FROM organizers WHERE id = $1', [req.params.id]);
        res.json(result.rows[0]);
    } catch (err) {
        console.error(`[/api/organizers/:id] Error:`, err.stack);
        res.status(500).send('Server Error');
    }
});

app.get('/api/organizers/:id/protests', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM protests WHERE organizer_id = $1 ORDER BY date DESC', [req.organizerId]);
        res.json(result.rows);
    } catch (err) {
        console.error(`[/api/organizers/:id/protests] Error:`, err.stack);
        res.status(500).send('Server Error');
    }
});

app.get('/api/organizers/:id/analytics', auth, async (req, res) => {
     try {
        const followersRes = await pool.query('SELECT followers FROM organizers WHERE id = $1', [req.organizerId]);
        const likesRes = await pool.query('SELECT SUM(likes) as total_likes FROM protests WHERE organizer_id = $1', [req.organizerId]);
        
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
        const result = await pool.query(
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
        const result = await pool.query(
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
        const result = await pool.query('SELECT * FROM protests WHERE date >= CURRENT_DATE ORDER BY date, time');
        res.json(result.rows);
    } catch (err) {
        console.error(`[/api/protests] GET Error:`, err.stack);
        res.status(500).send('Server Error');
    }
});

app.get('/', (req, res) => {
  res.send('Protest Tracker API is running.');
});


// --- SERVERLESS WRAPPER FOR VERCEL ---
// This ensures the database is ready before any request is handled.
const ensureDbIsReady = () => {
  if (!initializationPromise) {
    initializationPromise = initializeDb();
  }
  return initializationPromise;
};

module.exports = async (req, res) => {
  try {
    // Wait for the initialization to complete on the first request.
    // Subsequent requests will resolve immediately.
    await ensureDbIsReady();
    // Pass the request to the Express app.
    app(req, res);
  } catch (error) {
    console.error("Critical error in serverless handler:", error.stack);
    res.status(500).json({ 
        message: "Server failed to initialize.", 
        error: error.message 
    });
  }
};

