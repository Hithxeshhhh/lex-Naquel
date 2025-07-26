const express = require("express");
const cors = require("cors");
const http = require("http");
const https = require("https");
const fs = require("fs");
require("dotenv").config({ quiet: true });
const pool = require('./config/db');

const app = express();
const port = process.env.PORT;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/naquel', require('./routes/naquel'));

// Test database connection on startup
const testDatabaseConnection = async () => {
    let connection;
    try {
      connection = await pool.getConnection();
      await connection.execute('SELECT 1');
      console.log('Connected to DB');
    } catch (error) {
      console.error('Database connection failed:', error.message);
      console.error('Server will continue running, but database operations will fail');
    } finally {
      if (connection) {
        connection.release();
      }
    }
  };

// Start server with HTTP/HTTPS based on environment
const startServer = async () => {
  console.log('Testing database connection...');
  await testDatabaseConnection();
  
  if (process.env.NODE_ENV === "local") {
    const server = http.createServer(app);
    server.listen(port, () => {
      console.log(`Servers running on ${port}...`);
    });
  } else {
    let keyPath = process.env.KEY_DEV;
    let certPath = process.env.CERT_DEV;
    const options = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    };
    const server = https.createServer(options, app);
    server.listen(port, () => {
      console.log(`Server running on ${port}...`);
    });
  }
};

startServer(); 