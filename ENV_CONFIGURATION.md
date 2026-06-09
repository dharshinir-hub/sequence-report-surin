# Environment Configuration (.env)

All settings are configurable via `.env` file. **No code changes needed!**

## Current Configuration

```env
# ThingsBoard Connection
THINGSBOARD_REST_URL=http://yantra24x7.cloud:8080
THINGSBOARD_USER=pms@gmail.com
THINGSBOARD_PASSWORD=pmspms

# MQTT (if needed in future)
MQTT_BROKER=mqtt://yantra24x7.cloud:1884
MQTT_TOPIC=sequence_report

# Customer (SURIN ONLY)
CUSTOMER_ID=ca71d920-4d2a-11f1-9352-592ed2a7210c
CUSTOMER_NAME=Surin

# Update Schedule
UPDATE_INTERVAL_MINUTES=2
TELEMETRY_LOOKBACK_HOURS=24

# Server
REPORTS_PORT=6005
NODE_ENV=development
```

## Configuration Options

### ThingsBoard Connection
```env
THINGSBOARD_REST_URL=http://yantra24x7.cloud:8080
```
- ThingsBoard REST API URL
- Used to authenticate and query device data

```env
THINGSBOARD_USER=pms@gmail.com
```
- ThingsBoard login username
- Has access to all SURIN customer devices

```env
THINGSBOARD_PASSWORD=pmspms
```
- ThingsBoard login password

### Customer Settings
```env
CUSTOMER_ID=ca71d920-4d2a-11f1-9352-592ed2a7210c
```
- ThingsBoard Customer UUID
- Only devices for this customer are processed
- Currently: SURIN only

```env
CUSTOMER_NAME=Surin
```
- Display name (shown in logs)
- No impact on functionality

### Update Schedule
```env
UPDATE_INTERVAL_MINUTES=2
```
- How often to refresh data from ThingsBoard
- Current: **Every 2 minutes**
- Changes data is corrected and cached

```env
TELEMETRY_LOOKBACK_HOURS=24
```
- How far back to fetch telemetry data
- Current: Last **24 hours**
- For each update cycle, fetches last 24 hours and corrects all records

### Server
```env
REPORTS_PORT=6005
```
- Port where API listens
- Frontend calls: `http://localhost:6005/report/...`

```env
NODE_ENV=development
```
- Environment: `development` or `production`

## What Happens at Startup

```
⚙️  Configuration:
   Update interval: 2 minute(s)
   Lookback period: 24 hour(s)

📊 Server: http://localhost:6005
🔄 Updates: Every 2 minutes

✅ Ready - Caching SURIN devices...

⏱️  [12:00:02] Updating SURIN devices...
  ✓ SURIN_PUNE-BFW01: 45 reports
  ✓ SURIN_PUNE-BFW02: 32 reports
  ✓ SURIN_PUNE-BFW03: 28 reports
✅ Updated at 12:00:02
```

## Update Cycle Explained

### Every 2 Minutes:
```
[Time: 12:00:02]
  1. Query ThingsBoard for SURIN customer
  2. Get all SURIN device IDs
  3. For each device:
     - Fetch sequence_report telemetry (last 24 hours)
     - Parse all entries
     - Cache in memory
  4. Previous data is OVERWRITTEN with corrected/updated data
  5. Next API request returns fresh cached data

[Time: 12:02:02]
  1. Repeat cycle
  2. Fetch last 24 hours again
  3. Correct any historical records
  4. Update cache with latest data

[Time: 12:04:02]
  Repeat...
```

## Changing Settings

### Change Update Frequency

```env
# Update every 1 minute
UPDATE_INTERVAL_MINUTES=1

# Update every 5 minutes
UPDATE_INTERVAL_MINUTES=5

# Update every 10 minutes
UPDATE_INTERVAL_MINUTES=10
```

Then restart:
```bash
npm start
```

### Change Historical Data Window

```env
# Keep only last 12 hours
TELEMETRY_LOOKBACK_HOURS=12

# Keep last 48 hours
TELEMETRY_LOOKBACK_HOURS=48

# Keep last 7 days
TELEMETRY_LOOKBACK_HOURS=168
```

### Switch Customer (if needed)

```env
# Get new customer ID from ThingsBoard
CUSTOMER_ID=new-customer-id-here
CUSTOMER_NAME=NewCustomer
```

Restart and it will only process that customer's devices.

## Verification

Check what's configured:
```bash
curl http://localhost:6005/api/v1/status

# Returns:
{
  "update_interval": "2 minutes",
  "devices_cached": 3,
  "customer": {
    "name": "Surin",
    "id": "ca71d920-4d2a-11f1-9352-592ed2a7210c"
  },
  "devices": [
    {"name": "SURIN_PUNE-BFW01", "reports_count": 45},
    {"name": "SURIN_PUNE-BFW02", "reports_count": 32},
    {"name": "SURIN_PUNE-BFW03", "reports_count": 28}
  ]
}
```

## How Data is Corrected

### Scenario:
- Part finishes at 12:00:00
- Report shows: incomplete, run_time=0

**At 12:02:02 (first update):**
- Fetches last 24 hours from ThingsBoard
- Finds the part from 12:00:00
- Sees it's now complete with run_time=1200
- **Updates cache** with corrected data

**Next API request (12:02:05):**
- Frontend gets corrected report
- run_time=1200 (no longer 0)

**At 12:04:02 (second update):**
- Fetches last 24 hours again
- Corrects any new changes
- Overwrites cache with latest

This ensures **always fresh, corrected data every 2 minutes!**

## Summary

```
✅ All settings in .env
✅ No code changes needed
✅ Updates every 2 minutes (configurable)
✅ Corrects previous data automatically
✅ Fetches last 24 hours (configurable)
✅ Ready for production
```

Just edit `.env` and restart:
```bash
npm start
```

Done! 🎉
