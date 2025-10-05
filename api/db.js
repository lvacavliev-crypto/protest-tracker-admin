const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.PROTEST_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

let dbInitializationPromise = null;

async function initializeDatabase() {
  const client = await pool.connect();
  try {
    // Create organizers table
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

    // Create protests table
    await client.query(`
      CREATE TABLE IF NOT EXISTS protests (
        id SERIAL PRIMARY KEY,
        organizer_id INT REFERENCES organizers(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        cause VARCHAR(255),
        description TEXT,
        location TEXT,
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

    console.log('Database tables initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
    throw error;
  } finally {
    client.release();
  }
}

const ensureDbReady = () => {
  if (!dbInitializationPromise) {
    dbInitializationPromise = initializeDatabase();
  }
  return dbInitializationPromise;
};

module.exports = {
  query: (text, params) => pool.query(text, params),
  ensureDbReady,
};
