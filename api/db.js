const { Pool } = require('pg');

// Create a single, shared connection pool.
// Vercel provides the full, correct connection string in the environment variable.
const pool = new Pool({
  connectionString: process.env.PROTEST_URL,
});

// A global promise to ensure the setup runs only once per server instance.
let dbInitializationPromise = null;

async function initializeDatabase() {
  console.log('Attempting to connect to the database...');
  const client = await pool.connect();
  console.log('Database connection successful. Ensuring tables exist...');
  try {
    // Create the organizers table if it doesn't exist
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
    // Create the protests table if it doesn't exist
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
    console.log('Database tables are ready.');
  } catch (error) {
    console.error('FATAL: Database initialization failed:', error);
    throw error; // Propagate the error to stop the serverless function
  } finally {
    client.release(); // Release the client back to the pool
  }
}

// This function ensures the database is initialized before any query is made.
async function ensureDbReady() {
  if (!dbInitializationPromise) {
    dbInitializationPromise = initializeDatabase();
  }
  return dbInitializationPromise;
}

module.exports = {
  // A simple query function that uses the shared pool
  query: (text, params) => pool.query(text, params),
  // The function to ensure the database is ready
  ensureDbReady,
};

