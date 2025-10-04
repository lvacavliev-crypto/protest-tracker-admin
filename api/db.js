const { Pool } = require('pg');

// Create one single pool instance.
const pool = new Pool({
  connectionString: process.env.PROTEST_URL,
  connectionTimeoutMillis: 15000,
});

// A global promise to ensure initialization only runs once.
let initializationPromise = null;

async function initializeDb() {
  let client;
  try {
    console.log("Attempting to connect to the database...");
    client = await pool.connect();
    console.log("Database connection successful. Ensuring tables exist...");

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

const ensureDbIsReady = () => {
  if (!initializationPromise) {
    initializationPromise = initializeDb();
  }
  return initializationPromise;
};

// Export a query function and the initialization function
module.exports = {
  query: (text, params) => pool.query(text, params),
  ensureDbIsReady,
};
