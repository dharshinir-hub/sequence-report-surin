# Simple Setup - Backend Works Like Your Old System

## How It Works (Same as Old Backend)

```
React Frontend
    ↓ Calls API
Backend (Port 6005)
    ↓ Queries when requested
ThingsBoard
    ↓ Returns data
Backend
    ↓ Transforms to report format
Frontend displays
```

**No MQTT waiting.** **No polling.** Just direct queries like your old system.

## Start Backend

```bash
cd C:\Users\yantra\Downloads\sequence_report
npm start
```

Expected output:
```
╔════════════════════════════════════════════════════════╗
║     SEQUENCE REPORT API - Ready for Production         ║
╚════════════════════════════════════════════════════════╝

📊 API Server: http://localhost:6005
🔗 ThingsBoard: http://yantra24x7.cloud:8080
👤 Username: pms@gmail.com

✅ Service is ready to receive requests from React frontend!
```

## API Endpoints (Your Frontend Already Calls These!)

### From your reportService.js:

```javascript
// These all work now:
getReportShifts(customerName)                    → /report/shift-list/{customerName}
getReportMachineList(customerName)               → /report/machine-list/{customerName}
getGeneralReport(machine, shift, from, to, ...)  → /report/general_report/...
getPartReport(machine, shift, from, to, ...)     → /report/part_report/...
getOeeReport(machine, shift, from, to, ...)      → /report/oee_report/...
getIdleReasonReport(...)                         → /report/idle_report/...
getAlarmReport(...)                              → /report/alarm_report/...
getEfficiencyReport(...)                         → /report/efficiency_report/...
getOperatorReport(...)                           → /report/operator_report/...
getSequenceReport(...)                           → /report/api/v1/sequence-report/...
```

## Configuration

**.env** - Already set:
```
THINGSBOARD_REST_URL=http://yantra24x7.cloud:8080
THINGSBOARD_USER=pms@gmail.com
THINGSBOARD_PASSWORD=pmspms
REPORTS_PORT=6005
```

## Data Comes From

### ThingsBoard Device Telemetry

Each device needs these keys in its telemetry:
```json
{
  "sequence_report": {
    "actual_part": 1,
    "machine_name": "SURIN_PUNE-BFW01",
    "operator_no": "OP001",
    "operator_name": "Operator Name",
    "component_no": "2462",
    "component_name": "Component Name",
    "serial_no": "467",
    "program_number": "O0516",
    "revision_number": "0",
    "start_time": 1779186293453,
    "end_time": 1779186400000,
    "run_time": 3600,
    "idle_time": 1200,
    "stop_time": 0,
    "network_f_time": 0,
    "sequence_detail": [
      {
        "value": 1,
        "start": 1779186293453,
        "end": 1779186400000,
        "actual_run": 3600,
        "actual_idle": 1200,
        "operation_status": "Running",
        "alarm": "-",
        "message": "-"
      }
    ]
  }
}
```

## Testing

```bash
# Test API
curl http://localhost:6005/health

# Get shifts
curl "http://localhost:6005/report/shift-list/SURIN"

# Get machines
curl "http://localhost:6005/report/machine-list/SURIN"

# Get general report
curl "http://localhost:6005/report/general_report/SURIN_PUNE-BFW01/1/1609459200000/1609545600000/1/10"
```

## Frontend Integration

✅ **No changes needed!**

Your React frontend in `C:\Users\yantra\Downloads\Zumen_PPW\react2024\` already has:

```javascript
// In reportService.js
const baseUrl = window._env_.SERVER_URL2.replace(/\/$/, '');
const url = `${baseUrl}/report/general_report/...`;
```

Just make sure .env has:
```
REACT_APP_SERVER_URL2=http://yantra24x7.cloud:6005
```

Then it will automatically call the backend on port 6005!

## Files

```
sequence_report/
├── index.js                      ← RUN THIS (simplified)
├── .env
├── src/
│   ├── thingsboardReportService.js  ← Queries ThingsBoard
│   └── routes/
│       └── reports.js              ← API endpoints
└── SIMPLE_SETUP.md              ← This file
```

## Data Flow Example

1. **Frontend calls**: `GET /report/general_report/SURIN_PUNE-BFW01/1/1609459200000/1609545600000/1/10`

2. **Backend does**:
   - Authenticate to ThingsBoard
   - Query: "Give me sequence_report telemetry for device SURIN_PUNE-BFW01 from time X to time Y"
   - ThingsBoard returns array of reports
   - Parse and transform to match old format
   - Return to frontend

3. **Frontend displays** in table

## Production Deployment

### Option 1: PM2 (Recommended)
```bash
npm install -g pm2
pm2 start index.js --name "sequence-report"
pm2 save
pm2 startup
```

### Option 2: Windows Service
```bash
npm install -g nssm
nssm install SequenceReport "C:\Program Files\nodejs\node.exe" "C:\Users\yantra\Downloads\sequence_report\index.js"
nssm start SequenceReport
```

### Option 3: Docker
```bash
docker run -p 6005:6005 \
  -e THINGSBOARD_REST_URL=http://yantra24x7.cloud:8080 \
  -e THINGSBOARD_USER=pms@gmail.com \
  -e THINGSBOARD_PASSWORD=pmspms \
  node:18 node /app/index.js
```

## That's It!

Your backend is now:
- ✅ Querying ThingsBoard instead of MongoDB
- ✅ Serving the same API your frontend expects
- ✅ No changes needed to frontend
- ✅ Works exactly like your old system

Just run: `npm start`

Done! 🎉
