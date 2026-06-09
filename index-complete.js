const fs = require('fs');
const path = require('path');
const mqtt = require('mqtt');
const express = require('express');
const bodyParser = require('body-parser');
const SequenceProcessor = require('./src/sequenceProcessor');
const ThingsboardClient = require('./src/thingsboardClient');
const reportRoutes = require('./src/routes/reports');

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

// Initialize apps
const mqttApp = express();
const reportsApp = express();
mqttApp.use(bodyParser.json());
reportsApp.use(bodyParser.json());

// In-memory storage for active parts per device
const activePartsStore = {};

const processor = new SequenceProcessor();
const tbClient = new ThingsboardClient();

let mqttClient;

// ============================================
// MQTT PROCESSOR (Port 6003)
// ============================================

async function initMQTT() {
  return new Promise((resolve, reject) => {
    mqttClient = mqtt.connect(env.MQTT_BROKER || 'mqtt://yantra24x7.cloud:1884', {
      username: env.THINGSBOARD_USER,
      password: env.THINGSBOARD_PASSWORD,
      clean: true,
      reconnectPeriod: 5000
    });

    mqttClient.on('connect', () => {
      console.log('✓ MQTT Connected to', env.MQTT_BROKER);
      mqttClient.subscribe(env.MQTT_TOPIC || 'sequence_report', (err) => {
        if (err) reject(err);
        else {
          console.log(`✓ Subscribed to topic: ${env.MQTT_TOPIC}`);
          resolve();
        }
      });
    });

    mqttClient.on('message', async (topic, message) => {
      try {
        const payload = JSON.parse(message.toString());
        console.log(`\n📨 Received on ${topic}:`, payload);

        const deviceId = payload.device_id;
        const deviceName = payload.deviceName;
        const ts = parseInt(payload.ts);

        // Initialize device store
        if (!activePartsStore[deviceId]) {
          activePartsStore[deviceId] = {
            deviceName,
            activePart: null,
            completedParts: []
          };
        }

        // Fetch live data from ThingsBoard
        const liveData = await tbClient.getDeviceTelemetry(deviceId, ['live_operator', 'live_component', 'machine_status']);

        // Process the trigger
        const result = await processor.processTrigger(
          payload,
          activePartsStore[deviceId],
          liveData,
          deviceId
        );

        // Handle part updates
        if (result.closedPart) {
          console.log(`✓ Part ${result.closedPart.actual_part} completed`);
          await tbClient.postSequenceReport(deviceId, result.closedPart);
        }

        if (result.newPart) {
          console.log(`✓ Created Part ${result.newPart.actual_part}`);
          await tbClient.postSequenceReport(deviceId, result.newPart);
        }

      } catch (error) {
        console.error('Error processing MQTT message:', error.message);
      }
    });

    mqttClient.on('error', reject);
  });
}

// MQTT Endpoints
mqttApp.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'mqtt-processor' });
});

mqttApp.get('/api/v1/debug/active-parts', (req, res) => {
  res.json(activePartsStore);
});

mqttApp.post('/api/v1/debug/reset/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  if (activePartsStore[deviceId]) {
    activePartsStore[deviceId].activePart = null;
    activePartsStore[deviceId].completedParts = [];
  }
  res.json({ message: `Reset state for device ${deviceId}` });
});

// ============================================
// REPORTS API (Port 6005)
// ============================================

// Add CORS headers
reportsApp.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Register report routes
reportsApp.use('/report', reportRoutes);

// Health check for reports
reportsApp.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'reports-api' });
});

// ============================================
// START SERVERS
// ============================================

async function start() {
  try {
    // Start MQTT processor
    await initMQTT();
    const mqttServer = mqttApp.listen(env.PORT || 6003, () => {
      console.log(`\n✓ MQTT Processor running on port ${env.PORT || 6003}`);
    });

    // Start Reports API
    const reportsServer = reportsApp.listen(env.REPORTS_PORT || 6005, () => {
      console.log(`✓ Reports API running on port ${env.REPORTS_PORT || 6005}`);
      console.log('\n=== SEQUENCE REPORT SYSTEM READY ===\n');
      console.log('📡 MQTT Processor: http://localhost:' + (env.PORT || 6003));
      console.log('📊 Reports API:    http://localhost:' + (env.REPORTS_PORT || 6005));
      console.log('🔗 ThingsBoard:    ' + env.THINGSBOARD_REST_URL);
    });

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\nShutting down...');
      if (mqttClient) mqttClient.end();
      mqttServer.close();
      reportsServer.close();
      process.exit(0);
    });

  } catch (error) {
    console.error('Failed to start:', error);
    process.exit(1);
  }
}

start();
