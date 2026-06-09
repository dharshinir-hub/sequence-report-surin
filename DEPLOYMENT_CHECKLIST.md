# Deployment Checklist

## Pre-Deployment ✓

- [x] npm packages installed
- [x] MQTT Processor logic implemented
- [x] Reports API routes created
- [x] ThingsBoard integration layer built
- [x] Configuration in .env set

## Quick Start

```bash
# 1. Navigate to project
cd C:\Users\yantra\Downloads\sequence_report

# 2. Start the service
npm start

# 3. Verify both services running
curl http://localhost:6003/health  # MQTT Processor
curl http://localhost:6005/health  # Reports API
```

## Expected Output

```
✓ MQTT Connected to mqtt://yantra24x7.cloud:1884
✓ Subscribed to topic: sequence_report
✓ MQTT Processor running on port 6003
✓ Reports API running on port 6005

=== SEQUENCE REPORT SYSTEM READY ===

📡 MQTT Processor: http://localhost:6003
📊 Reports API:    http://localhost:6005
🔗 ThingsBoard:    http://yantra24x7.cloud:8080
```

## Frontend Integration (No Changes Needed!)

Your React frontend in `C:\Users\yantra\Downloads\Zumen_PPW\react2024\` already calls:
- ✅ `http://yantra24x7.cloud:6005/report/shift-list/...`
- ✅ `http://yantra24x7.cloud:6005/report/machine-list/...`
- ✅ `http://yantra24x7.cloud:6005/report/general_report/...`
- ✅ `http://yantra24x7.cloud:6005/report/part_report/...`
- ✅ And all other report endpoints

Just verify in your frontend's `.env`:
```
REACT_APP_SERVER_URL2=http://yantra24x7.cloud:6005
```

## Data Flow (What Happens)

1. **CNC Machine** sends MQTT: `parts_count=1`
2. **MQTT Processor** receives, processes, posts to ThingsBoard
3. **React Frontend** queries: `GET /report/general_report/...`
4. **Reports API** fetches from ThingsBoard, transforms, returns to frontend
5. **Frontend** displays in table

## File Structure

```
sequence_report/
├── index-complete.js              ← RUN THIS (combined server)
├── .env                           ← Configuration
├── package.json
├── src/
│   ├── sequenceProcessor.js       ← State machine logic
│   ├── thingsboardClient.js       ← ThingsBoard REST client
│   ├── thingsboardReportService.js ← Report queries
│   └── routes/
│       └── reports.js             ← API endpoints
├── INTEGRATION_GUIDE.md           ← Full documentation
├── README.md                      ← Technical overview
└── QUICKSTART.md                 ← Quick reference
```

## Configuration Files

### .env (Already configured)
```
THINGSBOARD_REST_URL=http://yantra24x7.cloud:8080
THINGSBOARD_USER=pms@gmail.com
THINGSBOARD_PASSWORD=pmspms
MQTT_BROKER=mqtt://yantra24x7.cloud:1884
MQTT_TOPIC=sequence_report
REPORTS_PORT=6005
```

## Testing

### 1. Health Check
```bash
curl http://localhost:6005/health
# Response: {"status":"ok","timestamp":"...","service":"reports-api"}
```

### 2. Get Machines
```bash
curl "http://localhost:6005/report/machine-list/SURIN"
```

### 3. Get Shift List
```bash
curl "http://localhost:6005/report/shift-list/SURIN"
```

### 4. Get Reports
```bash
curl "http://localhost:6005/report/general_report/SURIN_PUNE-BFW01/1/1609459200000/1609545600000/1/10"
```

## Production Deployment

### Option 1: Windows Service
```bash
npm install -g nssm
nssm install SequenceReport "C:\Program Files\nodejs\node.exe" "C:\Users\yantra\Downloads\sequence_report\index-complete.js"
nssm start SequenceReport
```

### Option 2: PM2 (Recommended)
```bash
npm install -g pm2
pm2 start index-complete.js --name "sequence-report"
pm2 save
pm2 startup
pm2 logs
```

### Option 3: Docker
```bash
docker build -t sequence-report .
docker run -p 6003:6003 -p 6005:6005 -e THINGSBOARD_REST_URL=... sequence-report
```

## Monitoring

### Check if running
```bash
# Windows
netstat -ano | findstr :6005

# Linux/Mac
lsof -i :6005
```

### View logs
```bash
# Real-time logs
pm2 logs sequence-report

# Or if running directly
# Output will show in terminal
```

## Backup & Recovery

### Backup this system
```bash
tar -czf sequence_report_backup_$(date +%Y%m%d).tar.gz C:\Users\yantra\Downloads\sequence_report\
```

### Backup to GitHub
```bash
cd C:\Users\yantra\Downloads\sequence_report
git init
git add .
git commit -m "Sequence report system"
git remote add origin https://github.com/your-username/sequence_report.git
git push -u origin main
```

## Rollback Plan

If something goes wrong:

1. **Stop the service**
   ```bash
   pm2 stop sequence-report
   ```

2. **Revert to backup**
   ```bash
   rm -rf C:\Users\yantra\Downloads\sequence_report
   tar -xzf sequence_report_backup_YYYYMMDD.tar.gz
   ```

3. **Restart old backend** (if you kept it)
   ```bash
   cd C:\Users\yantra\YANTRA-JOB
   npm start
   ```

## Success Indicators ✓

After deployment, verify:
- [ ] MQTT Processor connected and listening
- [ ] Reports API responding to requests
- [ ] Frontend displays reports (no errors in console)
- [ ] ThingsBoard receiving sequence_report telemetry
- [ ] New MQTT messages trigger sequence processing
- [ ] Reports API queries return data from ThingsBoard

## Support

**Issues?** Check:
1. `.env` configuration (credentials, URLs)
2. ThingsBoard is accessible and has telemetry data
3. MQTT broker is reachable
4. Firewall allows ports 6003, 6005
5. Device IDs match between MQTT and ThingsBoard

**All logs are printed to console** - check terminal output for errors.
