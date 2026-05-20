const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');

// Load .env file manually
const envPath = path.join(__dirname, '.env');
const env = {};
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value && !key.startsWith('#')) {
      env[key.trim()] = value.trim();
    }
  });
}

const SequenceProcessor = require('./src/sequenceProcessor');

// In-memory storage
const activePartsStore = {};
const processor = new SequenceProcessor();

// Simple MQTT connection (for development - using raw TCP)
class SimpleMQTTClient {
  constructor(brokerUrl) {
    this.url = brokerUrl;
    this.callbacks = {};
    this.connected = false;
  }

  on(event, callback) {
    if (!this.callbacks[event]) this.callbacks[event] = [];
    this.callbacks[event].push(callback);
  }

  connect() {
    // Parse mqtt://host:port
    const urlParts = this.url.replace('mqtt://', '').split(':');
    const host = urlParts[0];
    const port = urlParts[1] || 1883;

    this.socket = net.createConnection(port, host, () => {
      console.log('✓ Connected to MQTT broker');
      this.connected = true;
      if (this.callbacks.connect) {
        this.callbacks.connect.forEach(cb => cb());
      }
    });

    this.socket.on('error', (err) => {
      console.error('✗ MQTT connection error:', err.message);
      if (this.callbacks.error) {
        this.callbacks.error.forEach(cb => cb(err));
      }
    });

    this.socket.on('close', () => {
      console.log('✗ MQTT connection closed');
      this.connected = false;
    });
  }

  subscribe(topic, callback) {
    console.log(`✓ Subscribed to topic: ${topic}`);
    // Note: Full MQTT protocol not implemented, simulating with placeholder
    if (callback) callback(null);
  }

  end() {
    if (this.socket) this.socket.end();
  }
}

// Simple HTTP server using built-in http module
function startServer(port) {
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, `http://${req.headers.host}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    if (pathname === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    } else if (pathname === '/api/v1/debug/active-parts') {
      res.writeHead(200);
      res.end(JSON.stringify(activePartsStore));
    } else if (pathname.startsWith('/api/v1/debug/reset/')) {
      const deviceId = pathname.split('/').pop();
      if (activePartsStore[deviceId]) {
        activePartsStore[deviceId].activePart = null;
        activePartsStore[deviceId].completedParts = [];
      }
      res.writeHead(200);
      res.end(JSON.stringify({ message: `Reset state for device ${deviceId}` }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });

  server.listen(port, () => {
    console.log(`✓ Server running on port ${port}`);
  });

  return server;
}

// Simulate MQTT message processing
function simulateMQTTMessage(payload) {
  const deviceId = payload.device_id;
  const deviceName = payload.deviceName;
  const ts = parseInt(payload.ts);

  console.log(`\n📨 Received MQTT message:`, payload);

  // Initialize device store
  if (!activePartsStore[deviceId]) {
    activePartsStore[deviceId] = {
      deviceName,
      activePart: null,
      completedParts: []
    };
  }

  // Process trigger
  const result = processor.processTrigger(
    payload,
    activePartsStore[deviceId],
    {},
    deviceId
  );

  if (result.closedPart) {
    console.log(`✓ Part ${result.closedPart.actual_part} completed`);
    console.log(JSON.stringify(result.closedPart, null, 2));
  }

  if (result.newPart) {
    console.log(`✓ Created Part ${result.newPart.actual_part}`);
    console.log(JSON.stringify(result.newPart, null, 2));
  }
}

// Start server
console.log('\n=== SEQUENCE REPORT MQTT PROCESSOR ===\n');
startServer(env.PORT || 6003);

// Note: Full MQTT protocol implementation would require mqtt npm package
// This standalone version demonstrates the processing logic
console.log(`
📝 STANDALONE MODE (no npm dependencies)
   - HTTP Server: ✓ Running
   - MQTT: ⏳ Requires npm mqtt package for full functionality

TO TEST:
1. Send POST request with JSON body to test processing
2. Or install npm packages: npm install mqtt
3. Then switch back to: npm start

EXAMPLE TEST REQUEST:
POST http://localhost:${env.PORT || 6003}/test-trigger
{
  "parts_count": 1,
  "device_id": "d367dac0-4d2a-11f1-9352-592ed2a7210c",
  "deviceName": "SURIN_PUNE-BFW01",
  "ts": "1779193197944"
}
`);

// Add test trigger endpoint
const testServer = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/test-trigger') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        simulateMQTTMessage(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Processed trigger' }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

testServer.listen(env.PORT || 6003);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  testServer.close();
  process.exit(0);
});
