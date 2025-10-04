// Import necessary packages
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const app = express();
const port = 3001;

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- Database Connection ---
const pool = new Pool({
  user: 'protest_user',
  host: 'localhost',
  database: 'protest_tracker_db',
  password: 'password',
  port: 5432,
});

// --- Database Table Creation ---
const createTables = async () => {
  const createProtestsTableQuery = `
    CREATE TABLE IF NOT EXISTS protests (
      id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, cause VARCHAR(255), description TEXT,
      lat DECIMAL NOT NULL, lng DECIMAL NOT NULL, date DATE NOT NULL, time TIME NOT NULL,
      location VARCHAR(255), organizer_id INT, attendees INT DEFAULT 0, likes INT DEFAULT 0,
      official_link VARCHAR(255), tags TEXT[]
    );`;
  
  const createOrganizersTableQuery = `
    CREATE TABLE IF NOT EXISTS organizers (
      id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, email VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL, bio TEXT, followers INT DEFAULT 0, instagram VARCHAR(255),
      website VARCHAR(255), facebook VARCHAR(255)
    );`;

  try {
    await pool.query(createProtestsTableQuery);
    await pool.query(createOrganizersTableQuery);
    console.log("Tables are successfully created or already exist.");
  } catch (err) {
    console.error("Error creating tables", err.stack);
  }
};

// --- API Endpoints ---

// --- Organizer Auth Endpoints ---
app.post('/api/organizers/register', async (req, res) => {
    try {
        const { name, email, password, bio } = req.body;
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        const newUser = await pool.query(
            "INSERT INTO organizers (name, email, password, bio) VALUES ($1, $2, $3, $4) RETURNING id, name, email",
            [name, email, hashedPassword, bio]
        );
        res.status(201).json(newUser.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ message: "Server error during registration." });
    }
});

app.post('/api/organizers/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await pool.query("SELECT * FROM organizers WHERE email = $1", [email]);
        if (user.rows.length === 0) {
            return res.status(400).json({ message: "Invalid credentials" });
        }
        const isValidPassword = await bcrypt.compare(password, user.rows[0].password);
        if (!isValidPassword) {
            return res.status(400).json({ message: "Invalid credentials" });
        }
        // In a real app, you would generate and return a JWT here.
        // For simplicity, we just return the organizer's data.
        const { password: _, ...organizerData } = user.rows[0];
        res.json({ message: "Login successful", organizer: organizerData });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ message: "Server error during login." });
    }
});

// --- Protest Endpoints ---
app.get('/api/protests', async (req, res) => { /* ... existing code ... */ });
app.get('/api/protests/:id', async (req, res) => { /* ... existing code ... */ });
app.post('/api/protests/:id/like', async (req, res) => { /* ... existing code ... */ });

app.post('/api/protests', async (req, res) => {
    // This endpoint should be protected and only accessible by logged-in organizers
    try {
        const { name, cause, description, lat, lng, date, time, location, organizer_id, official_link, tags } = req.body;
        const newProtest = await pool.query(
            `INSERT INTO protests (name, cause, description, lat, lng, date, time, location, organizer_id, official_link, tags) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            [name, cause, description, lat, lng, date, time, location, organizer_id, official_link, tags]
        );
        res.status(201).json(newProtest.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ message: "Server Error while creating protest." });
    }
});

app.put('/api/protests/:id', async (req, res) => {
    // This endpoint should also be protected
    try {
        const { id } = req.params;
        const { name, cause, description, lat, lng, date, time, location, official_link, tags } = req.body;
        const updatedProtest = await pool.query(
            `UPDATE protests SET name = $1, cause = $2, description = $3, lat = $4, lng = $5, date = $6, time = $7, location = $8, official_link = $9, tags = $10 
             WHERE id = $11 RETURNING *`,
            [name, cause, description, lat, lng, date, time, location, official_link, tags, id]
        );
        if (updatedProtest.rows.length === 0) return res.status(404).json("Protest not found");
        res.json(updatedProtest.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ message: "Server Error while updating protest." });
    }
});

// --- Organizer Data Endpoints ---
app.get('/api/organizers/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const organizer = await pool.query("SELECT id, name, bio, followers, email, instagram, website, facebook FROM organizers WHERE id = $1", [id]);
        if (organizer.rows.length === 0) return res.status(404).json("Organizer not found");
        res.json(organizer.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

app.get('/api/organizers/:id/protests', async (req, res) => {
    try {
        const { id } = req.params;
        const protests = await pool.query("SELECT * FROM protests WHERE organizer_id = $1 ORDER BY date DESC", [id]);
        res.json(protests.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

app.get('/api/organizers/:id/analytics', async (req, res) => {
    // This is mock data for now. A real implementation would calculate this from the database.
    res.json({
        followers: Math.floor(Math.random() * 10000),
        total_likes: Math.floor(Math.random() * 50000),
        social_clicks: Math.floor(Math.random() * 5000)
    });
});

// --- Start Server ---
app.listen(port, () => {
  console.log(`Protest Tracker API server listening at http://localhost:${port}`);
  createTables();
});

