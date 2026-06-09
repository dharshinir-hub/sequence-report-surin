# Sequence Report System - Integration Guide

## Overview

This system replaces your old database backend with **ThingsBoard as the data source**. The React frontend remains unchanged, but now gets data from ThingsBoard instead of MongoDB.

```
React Frontend (Zumen_PPW/react2024)
        ↓ API calls to http://yantra24x7.cloud:6005
Backend (Sequence Report System)
        ↓ Queries ThingsBoard
ThingsBoard
        ↓ Device Telemetry
CNC Machines (MQTT)
```

## Architecture

### Two Services Running in Parallel

#### 1. MQTT Processor (Port 6003)
- Subscribes to MQTT topic: `sequence_report`
- Receives real-time triggers from machines
- Processes part records using state machine logic
- Posts completed reports back to ThingsBoard
- **Purpose**: Real-time data ingestion and processing

#### 2. Reports API (Port 6005) ← **Frontend connects here**
- Exposes REST API endpoints that frontend expects
- Queries ThingsBoard telemetry data
- Transforms data into report format
- Returns JSON to React frontend
- **Purpose**: Historical data queries and reporting

## Deployment

### Step 1: Start the Backend Service

```bash
cd C:\Users\yantra\Downloads\sequence_report
npm start
```

You should see:
```
✓ MQTT Connected to mqtt://yantra24x7.cloud:1884
✓ Subscribed to topic: sequence_report
✓ MQTT Processor running on port 6003
✓ Reports API running on port 6005
=== SEQUENCE REPORT SYSTEM READY ===
```

### Step 2: Verify Configuration

Check `.env` file:
```
THINGSBOARD_REST_URL=http://yantra24x7.cloud:8080
THINGSBOARD_USER=pms@gmail.com
THINGSBOARD_PASSWORD=pmspms
MQTT_BROKER=mqtt://yantra24x7.cloud:1884
REPORTS_PORT=6005
```

### Step 3: No Frontend Changes Needed!

Your React frontend in `C:\Users\yantra\Downloads\Zumen_PPW\react2024\` continues to work as-is. It will automatically:
- Call `http://yantra24x7.cloud:6005/report/general_report/...`
- Call `http://yantra24x7.cloud:6005/report/part_report/...`
- Call `http://yantra24x7.cloud:6005/report/shift-list/...`
- And all other existing endpoints

## API Endpoints

All endpoints match your existing frontend expectations:

### Report Endpoints
```
GET /report/shift-list/{customerName}
GET /report/machine-list/{customerName}
GET /report/general_report/{machine}/{shiftNo}/{fromTime}/{toTime}/{page}/{limit}
GET /report/part_report/{machine}/{shiftNo}/{fromTime}/{toTime}/{page}/{limit}
GET /report/oee_report/{machine}/{shiftNo}/{fromTime}/{toTime}/{page}/{limit}
GET /report/idle_report/{machine}/{shiftNo}/{fromTime}/{toTime}/{page}/{limit}
GET /report/alarm_report/{machine}/{shiftNo}/{fromTime}/{toTime}/{page}/{limit}
GET /report/efficiency_report/{machine}/{shiftNo}/{fromTime}/{toTime}/{page}/{limit}
GET /report/operator_report/{machine}/{shiftNo}/{operators}/{fromTime}/{toTime}/{page}/{limit}
GET /report/api/v1/sequence-report/{machine}/{shiftNo}/{fromTime}/{toTime}/{page}/{limit}
```

### Health Check
```
GET /health
GET http://localhost:6003/health  (MQTT processor)
GET http://localhost:6005/health  (Reports API)
```

## Data Flow

### Real-time Sequence Report Generation

1. **Machine sends MQTT message** with `parts_count: 1`
   ```json
   {
     "parts_count": 1,
     "device_id": "d367dac0-...",
     "deviceName": "SURIN_PUNE-BFW01",
     "ts": "1779193197944"
   }
   ```

2. **MQTT Processor (Port 6003) receives & processes it**
   - Creates Part #1 record in memory
   - Fetches `live_operator`, `live_component`, `machine_status` from ThingsBoard
   - Calculates timings from machine status
   - Posts Part #1 to ThingsBoard telemetry

3. **Machine sends next trigger** with `parts_count: 2`
   - Processor closes Part #1
   - Posts Part #1 to ThingsBoard (with ts = Part #1's start_time)
   - Creates Part #2 and posts it

4. **React Frontend queries reports** via Reports API (Port 6005)
   - API queries ThingsBoard for `sequence_report` telemetry
   - Transforms data into report format
   - Returns to React frontend
   - Frontend displays in table

## Configuration for Production

### Environment Variables (.env)

```env
# ThingsBoard Connection
THINGSBOARD_REST_URL=http://yantra24x7.cloud:8080
THINGSBOARD_USER=pms@gmail.com
THINGSBOARD_PASSWORD=pmspms

# MQTT Broker
MQTT_BROKER=mqtt://yantra24x7.cloud:1884
MQTT_TOPIC=sequence_report

# Service Ports
MQTT_PORT=6003
REPORTS_PORT=6005

# Device Configuration (add your machine device IDs)
DEVICE_IDS=d367dac0-4d2a-11f1-9352-592ed2a7210c,other-device-id-here

NODE_ENV=production
```

### Running as Background Service (Windows)

Use `nssm` (Non-Sucking Service Manager):

```bash
nssm install SequenceReportService "C:\Program Files\nodejs\node.exe" "C:\Users\yantra\Downloads\sequence_report\index-complete.js"
nssm start SequenceReportService
```

### Running as Background Service (Linux/Mac)

Use `pm2`:

```bash
npm install -g pm2
pm2 start index-complete.js --name "sequence-report"
pm2 save
pm2 startup
```

## Monitoring

### Check if services are running

```bash
# Check MQTT Processor
curl http://localhost:6003/health

# Check Reports API
curl http://localhost:6005/health

# View active parts in processor
curl http://localhost:6003/api/v1/debug/active-parts
```

### Logs

The service outputs logs to console:
```
📨 Received on sequence_report: {parts_count: 1, ...}
✓ Created Part 1
✓ Posted sequence_report for part 1 with ts=1779193197944
```

## Testing

### Test MQTT Message Processing

```bash
mosquitto_pub -h yantra24x7.cloud -p 1884 -u pms@gmail.com -P pmspms \
  -t sequence_report \
  -m '{"parts_count":1,"device_id":"d367dac0-...","deviceName":"SURIN_PUNE-BFW01","ts":"1779193197944"}'
```

### Test Reports API

```bash
# Get shift list
curl "http://localhost:6005/report/shift-list/SURIN"

# Get machine list
curl "http://localhost:6005/report/machine-list/SURIN"

# Get general report
curl "http://localhost:6005/report/general_report/SURIN_PUNE-BFW01/1/1609459200000/1609545600000/1/10"
```

## ThingsBoard Telemetry Structure

### Expected Keys in Device Telemetry

```json
{
  "live_operator": {
    "code": "OP001",
    "name": "Operator Name",
    "start_time": 1779186293453,
    "end_time": 1779187669094
  },
  "live_component": {
    "code": "2462",
    "name": "Component Name",
    "start_time": 1779186293453,
    "end_time": 1779187669094,
    "sequences": [
      {"sequence": "1", "touch_time": "00:00:30"},
      {"sequence": "2", "touch_time": "00:00:20"}
    ]
  },
  "machine_status": [
    [1779186293453, 3],  // [timestamp, status]
    [1779186300453, 0],  // 3=running, 0=idle, 5=alarm, 100=disconnect
    [1779186307453, 3]
  ],
  "sequence_report": {
    "actual_part": 1,
    "start_time": 1779186293453,
    "end_time": 1779186400000,
    ...
  }
}
```

## Troubleshooting

### MQTT not connecting
```
Error: Cannot find module 'mqtt'
→ Run: npm install
```

### ThingsBoard auth failed
```
Error: Authentication failed
→ Verify credentials in .env
→ Test login: curl -X POST http://yantra24x7.cloud:8080/api/auth/login -d '{"username":"pms@gmail.com","password":"pmspms"}'
```

### Reports returning empty data
```
→ Check if device has telemetry with "sequence_report" key in ThingsBoard
→ Check if time range (fromTime, toTime) is valid
→ Check device ID matches in both MQTT and ThingsBoard
```

### Frontend not connecting to API
```
Error: Cannot reach http://yantra24x7.cloud:6005
→ Verify backend is running: curl http://localhost:6005/health
→ Check firewall allows port 6005
→ Verify frontend API URL in frontend .env matches
```

## Migration from Old System

### Keep your existing MongoDB?
Yes! You can keep your old system running and run this in parallel:
- Old system: Port 6004 (or keep on 6005, then change new system)
- New system: Port 6005 (queries ThingsBoard)

### Switch frontend to new backend
Just change the API URL in your React frontend `.env`:
```env
REACT_APP_API_URL=http://yantra24x7.cloud:6005
```

No code changes needed!

## Next Steps

1. ✅ Start the backend: `npm start`
2. ✅ Verify reports API works: `curl http://localhost:6005/health`
3. ✅ Open frontend and test report queries
4. ✅ Monitor ThingsBoard for incoming MQTT messages
5. ✅ Set up automated deployment/backups

## Support

For issues or questions about:
- **MQTT Processing**: Check logs for `📨 Received` messages
- **ThingsBoard Queries**: Check device telemetry in ThingsBoard UI
- **Frontend Integration**: Check network tab in browser dev tools

All APIs are documented in the code comments. Extend them as needed!
