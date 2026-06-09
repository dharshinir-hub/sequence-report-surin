const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const ScheduledReportUpdater = require('./src/scheduledReportUpdater');

// Load .env file manually
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value && !key.startsWith('#')) {
      process.env[key.trim()] = value.trim();
    }
  });
}

const app = express();
app.use(bodyParser.json());

// Initialize scheduled updater (updates every 2 minutes)
const reportUpdater = new ScheduledReportUpdater();
reportUpdater.start();

// Share updater with routes
app.use((req, res, next) => {
  req.reportUpdater = reportUpdater;
  next();
});

// CORS headers for frontend
app.use((req, res, next) => {
  const origin = req.get('origin');
  // Allow local frontend + yantra domain + localhost
  const allowedOrigins = ['http://192.168.0.62:3000', 'http://yantra24x7.cloud:3000', 'http://localhost:3000', '*'];

  if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }

  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'sequence-report-api',
    thingsboard: process.env.THINGSBOARD_REST_URL,
    updater_status: 'running',
    last_update: reportUpdater.lastUpdate,
    devices_cached: Object.keys(reportUpdater.cachedReports).length
  });
});

// Status endpoint
app.get('/api/v1/status', (req, res) => {
  const status = reportUpdater.getStatus();
  res.json({
    ...status,
    customer: {
      name: CUSTOMER_NAME,
      id: CUSTOMER_ID
    }
  });
});

// Register report routes
const reportRoutes = require('./src/routes/reports');
app.use('/report', reportRoutes);
app.use('/api/v1', reportRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'Sequence Report API',
    version: '1.0.0',
    status: 'running',
    update_frequency: 'Every 2 minutes',
    last_update: reportUpdater.lastUpdate,
    devices_cached: Object.keys(reportUpdater.cachedReports).length,
    thingsboard: process.env.THINGSBOARD_REST_URL,
    port: process.env.REPORTS_PORT || 6005
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: err.message });
});

// Start server
const PORT = process.env.REPORTS_PORT || 6005;
const CUSTOMER_NAME = process.env.CUSTOMER_NAME || 'surin';
const CUSTOMER_ID = process.env.CUSTOMER_ID;

const server = app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║           SEQUENCE REPORT API - SURIN                     ║
╚═══════════════════════════════════════════════════════════╝

📊 Server: http://localhost:${PORT}
🔄 Updates: Every 2 minutes

✅ Ready - Caching SURIN devices...
  `);
});

// Handle port-already-in-use gracefully instead of crashing
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`
❌ Port ${PORT} is already in use.

   Another instance of this server is still running. To fix it, run:

   Windows (PowerShell):
     Get-Process node | Stop-Process -Force

   Then run "npm start" again.
`);
    process.exit(1);
  } else {
    console.error('Server error:', err.message);
    process.exit(1);
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nShutting down gracefully...');
  process.exit(0);
});
