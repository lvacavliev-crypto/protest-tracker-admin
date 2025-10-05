const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-this';

app.use(cors());
app.use(express.json());

// Middleware to verify JWT tokens
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// POST /api/register - Register new organizer
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password, bio } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, and password are required' });
    }

    // Check if email already exists
    const existingUser = await db.query('SELECT id FROM organizers WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Insert new organizer
    const result = await db.query(
      'INSERT INTO organizers (name, email, password_hash, bio) VALUES ($1, $2, $3, $4) RETURNING id, name, email, bio',
      [name, email, passwordHash, bio || '']
    );

    const organizer = result.rows[0];
    const token = jwt.sign({ id: organizer.id, email: organizer.email }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      message: 'Registration successful',
      token,
      organizer: { id: organizer.id, name: organizer.name, email: organizer.email, bio: organizer.bio }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error during registration' });
  }
});

// POST /api/login - Login organizer
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Find organizer
    const result = await db.query('SELECT * FROM organizers WHERE email = $1', [email]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const organizer = result.rows[0];

    // Verify password
    const validPassword = await bcrypt.compare(password, organizer.password_hash);
    if (!validPassword) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Generate token
    const token = jwt.sign({ id: organizer.id, email: organizer.email }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      message: 'Login successful',
      token,
      organizer: {
        id: organizer.id,
        name: organizer.name,
        email: organizer.email,
        bio: organizer.bio
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// GET /api/protests - Get all protests
app.get('/api/protests', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        p.id, p.name, p.cause, p.description, p.location, 
        p.latitude, p.longitude, p.date, p.time, 
        p.official_link, p.tags, p.likes,
        o.id as organizer_id, o.name as organizer_name
      FROM protests p
      JOIN organizers o ON p.organizer_id = o.id
      ORDER BY p.date ASC, p.time ASC
    `);

    const protests = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      cause: row.cause,
      description: row.description,
      location: row.location,
      lat: parseFloat(row.latitude),
      lng: parseFloat(row.longitude),
      date: row.date,
      time: row.time,
      officialLink: row.official_link,
      tags: row.tags || [],
      likes: row.likes,
      organizer: row.organizer_name,
      organizerId: row.organizer_id,
      attendees: Math.floor(row.likes * 3.5), // Estimate attendees
      distance: 0 // Would need user location to calculate
    }));

    res.json({ protests });
  } catch (error) {
    console.error('Get protests error:', error);
    res.status(500).json({ message: 'Server error fetching protests' });
  }
});

// POST /api/protests - Create new protest (authenticated)
app.post('/api/protests', authenticateToken, async (req, res) => {
  try {
    const { name, cause, description, location, latitude, longitude, date, time, official_link, tags } = req.body;

    if (!name || !date || !time) {
      return res.status(400).json({ message: 'Name, date, and time are required' });
    }

    const result = await db.query(`
      INSERT INTO protests (organizer_id, name, cause, description, location, latitude, longitude, date, time, official_link, tags)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [req.user.id, name, cause, description, location, latitude, longitude, date, time, official_link, tags || []]);

    res.status(201).json({ message: 'Protest created successfully', protest: result.rows[0] });
  } catch (error) {
    console.error('Create protest error:', error);
    res.status(500).json({ message: 'Server error creating protest' });
  }
});

// PUT /api/protests/:id - Update protest (authenticated, own protests only)
app.put('/api/protests/:id', authenticateToken, async (req, res) => {
  try {
    const protestId = req.params.id;
    const { name, cause, description, location, latitude, longitude, date, time, official_link, tags } = req.body;

    // Check if protest belongs to user
    const checkResult = await db.query('SELECT organizer_id FROM protests WHERE id = $1', [protestId]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ message: 'Protest not found' });
    }
    if (checkResult.rows[0].organizer_id !== req.user.id) {
      return res.status(403).json({ message: 'You can only edit your own protests' });
    }

    const result = await db.query(`
      UPDATE protests
      SET name = $1, cause = $2, description = $3, location = $4, 
          latitude = $5, longitude = $6, date = $7, time = $8, 
          official_link = $9, tags = $10
      WHERE id = $11
      RETURNING *
    `, [name, cause, description, location, latitude, longitude, date, time, official_link, tags || [], protestId]);

    res.json({ message: 'Protest updated successfully', protest: result.rows[0] });
  } catch (error) {
    console.error('Update protest error:', error);
    res.status(500).json({ message: 'Server error updating protest' });
  }
});

// DELETE /api/protests/:id - Delete protest (authenticated, own protests only)
app.delete('/api/protests/:id', authenticateToken, async (req, res) => {
  try {
    const protestId = req.params.id;

    // Check if protest belongs to user
    const checkResult = await db.query('SELECT organizer_id FROM protests WHERE id = $1', [protestId]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ message: 'Protest not found' });
    }
    if (checkResult.rows[0].organizer_id !== req.user.id) {
      return res.status(403).json({ message: 'You can only delete your own protests' });
    }

    await db.query('DELETE FROM protests WHERE id = $1', [protestId]);

    res.json({ message: 'Protest deleted successfully' });
  } catch (error) {
    console.error('Delete protest error:', error);
    res.status(500).json({ message: 'Server error deleting protest' });
  }
});

// GET /api/organizer/protests - Get logged-in organizer's protests
app.get('/api/organizer/protests', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT * FROM protests 
      WHERE organizer_id = $1 
      ORDER BY date ASC, time ASC
    `, [req.user.id]);

    res.json({ protests: result.rows });
  } catch (error) {
    console.error('Get organizer protests error:', error);
    res.status(500).json({ message: 'Server error fetching your protests' });
  }
});

// GET /api/organizer/stats - Get organizer statistics
app.get('/api/organizer/stats', authenticateToken, async (req, res) => {
  try {
    const protestsResult = await db.query('SELECT likes FROM protests WHERE organizer_id = $1', [req.user.id]);
    const organizerResult = await db.query('SELECT followers, social_clicks FROM organizers WHERE id = $1', [req.user.id]);

    const totalLikes = protestsResult.rows.reduce((sum, row) => sum + row.likes, 0);
    const followers = organizerResult.rows[0]?.followers || 0;
    const clicks = organizerResult.rows[0]?.social_clicks || 0;

    res.json({
      followers,
      totalInterest: totalLikes,
      clicks
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ message: 'Server error fetching statistics' });
  }
});

// POST /api/protests/:id/like - Toggle like on protest (stores in session/cookie in real app)
app.post('/api/protests/:id/like', async (req, res) => {
  try {
    const protestId = req.params.id;
    const { liked } = req.body; // true if liking, false if unliking

    const increment = liked ? 1 : -1;
    const result = await db.query(
      'UPDATE protests SET likes = GREATEST(0, likes + $1) WHERE id = $2 RETURNING likes',
      [increment, protestId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Protest not found' });
    }

    res.json({ likes: result.rows[0].likes });
  } catch (error) {
    console.error('Like protest error:', error);
    res.status(500).json({ message: 'Server error updating likes' });
  }
});

// POST /api/organizers/:id/follow - Toggle follow on organizer
app.post('/api/organizers/:id/follow', async (req, res) => {
  try {
    const organizerId = req.params.id;
    const { following } = req.body; // true if following, false if unfollowing

    const increment = following ? 1 : -1;
    const result = await db.query(
      'UPDATE organizers SET followers = GREATEST(0, followers + $1) WHERE id = $2 RETURNING followers',
      [increment, organizerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Organizer not found' });
    }

    res.json({ followers: result.rows[0].followers });
  } catch (error) {
    console.error('Follow organizer error:', error);
    res.status(500).json({ message: 'Server error updating followers' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Protest Tracker API is running' });
});

// Export for Vercel serverless
module.exports = async (req, res) => {
  try {
    await db.ensureDbReady();
    app(req, res);
  } catch (error) {
    console.error('CRITICAL: Serverless handler failed to initialize.', error);
    res.status(500).json({ message: 'Server failed to initialize.' });
  }
};
