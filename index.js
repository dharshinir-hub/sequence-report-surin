const fs = require('fs');
const path = require('path');

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

const mqtt = require('mqtt');
const express = require('express');
const bodyParser = require('body-parser');
const SequenceProcessor = require('./src/sequenceProcessor');
const ThingsboardClient = require('./src/thingsboardClient');

const app = express();
app.use(bodyParser.json());

// In-memory storage for active parts per device
const activePartsStore = {};

const processor = new SequenceProcessor();
const tbClient = new ThingsboardClient();

let mqttClient;

// Initialize MQTT connection
async function initMQTT() {
  return new Promise((resolve, reject) => {
    mqttClient = mqtt.connect(process.env.MQTT_BROKER, {
      username: process.env.THINGSBOARD_USER,
      password: process.env.THINGSBOARD_PASSWORD,
      clean: true,
      reconnectPeriod: 5000
    });

    mqttClient.on('connect', () => {
      console.log('✓ MQTT Connected to', process.env.MQTT_BROKER);
      mqttClient.subscribe(process.env.MQTT_TOPIC, (err) => {
        if (err) reject(err);
        else {
          console.log(`✓ Subscribed to topic: ${process.env.MQTT_TOPIC}`);
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

        // Initialize device store if needed
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
          // Post closed part to ThingsBoard with its start_time as timestamp
          await tbClient.postSequenceReport(deviceId, result.closedPart);
        }

        if (result.newPart) {
          console.log(`✓ Created Part ${result.newPart.actual_part}`);
          // Post new part (in-progress) immediately
          await tbClient.postSequenceReport(deviceId, result.newPart);
        }

      } catch (error) {
        console.error('Error processing MQTT message:', error.message);
      }
    });

    mqttClient.on('error', reject);
  });
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get active parts for debugging
app.get('/api/v1/debug/active-parts', (req, res) => {
  res.json(activePartsStore);
});

// Reset device state
app.post('/api/v1/debug/reset/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  if (activePartsStore[deviceId]) {
    activePartsStore[deviceId].activePart = null;
    activePartsStore[deviceId].completedParts = [];
  }
  res.json({ message: `Reset state for device ${deviceId}` });
});

// Start server
async function start() {
  try {
    await initMQTT();
    app.listen(process.env.PORT, () => {
      console.log(`✓ Server running on port ${process.env.PORT}`);
    });
  } catch (error) {
    console.error('Failed to start:', error);
    process.exit(1);
  }
}

start();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  if (mqttClient) mqttClient.end();
  process.exit(0);
});
