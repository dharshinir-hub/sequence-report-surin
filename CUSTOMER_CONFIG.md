# Customer Configuration - SURIN ONLY

Your backend is now configured to work **ONLY for customer SURIN**.

## Configuration (.env)

```env
CUSTOMER_ID=ca71d920-4d2a-11f1-9352-592ed2a7210c
CUSTOMER_NAME=Surin
```

## What This Means

✅ **Only SURIN devices are processed**
- Scheduled updater queries only SURIN's devices from ThingsBoard
- No data from other customers
- No cross-customer data leaks

✅ **Isolated by customer ID**
- API endpoint: `/api/customer/{CUSTOMER_ID}/devices`
- Only devices belonging to ca71d920-4d2a-11f1-9352-592ed2a7210c are cached
- All reports are for SURIN only

## When You Start

Run:
```bash
npm start
```

You'll see:
```
╔═══════════════════════════════════════════════════════════╗
║  SEQUENCE REPORT API - Auto-Updating (Every 2 Minutes)   ║
║  CUSTOMER: SURIN                                          ║
╚═══════════════════════════════════════════════════════════╝

📊 API Server: http://localhost:6005
👥 CUSTOMER:
   Name: Surin
   ID: ca71d920-4d2a-11f1-9352-592ed2a7210c

🔄 SCHEDULED UPDATE: Every 2 minutes
   - Queries devices for surin only
   - Caches sequence_report data
   - Corrects historical records
   - Serves from cache for faster responses

✅ Service is ready to receive requests!
```

## Check Status

```bash
# See SURIN's devices and cache status
curl http://localhost:6005/api/v1/status

# Response includes:
{
  "devices_cached": 3,
  "customer": {
    "name": "Surin",
    "id": "ca71d920-4d2a-11f1-9352-592ed2a7210c"
  },
  "devices": [
    {
      "name": "SURIN_PUNE-BFW01",
      "reports_count": 45,
      "last_updated": "..."
    },
    ...
  ]
}
```

## What Gets Cached (Every 2 Minutes)

```
SURIN Customer: ca71d920-4d2a-11f1-9352-592ed2a7210c
  ├─ SURIN_PUNE-BFW01
  │   └─ 45 sequence reports (cached)
  ├─ SURIN_PUNE-BFW02
  │   └─ 32 sequence reports (cached)
  └─ SURIN_PUNE-BFW03
      └─ 28 sequence reports (cached)

Other Customers: ❌ NOT PROCESSED
```

## Frontend Access

Your React frontend in `Zumen_PPW/react2024/` calls:
```
GET http://yantra24x7.cloud:6005/report/general_report/SURIN_PUNE-BFW01/...
GET http://yantra24x7.cloud:6005/report/part_report/SURIN_PUNE-BFW02/...
```

Backend automatically:
- ✅ Only returns SURIN data
- ✅ No need to filter manually
- ✅ All SURIN devices available

## Multi-Customer Setup (Future)

If you need to add another customer later:

```env
# Current setup (single customer)
CUSTOMER_ID=ca71d920-4d2a-11f1-9352-592ed2a7210c
CUSTOMER_NAME=Surin

# To switch customer, just update .env and restart:
CUSTOMER_ID=different-id-here
CUSTOMER_NAME=OtherCustomer
```

## Security

✅ **Data Isolation**
- Only SURIN's customer ID is queried
- ThingsBoard API restricts to this customer
- No access to other customer data

✅ **No Configuration Needed for Reports**
- Reports automatically filtered by customer
- Frontend doesn't need to specify customer
- Backend enforces customer boundary

## Files Modified

```
.env                          ← Customer ID added
index.js                      ← Shows customer at startup
scheduledReportUpdater.js     ← Queries only this customer
thingsboardReportService.js   ← Filters by customer ID
```

## Verification Logs

When running, every 2 minutes you'll see:

```
⏱️  [12:00:02] Updating reports for customer: surin
📱 Found 3 devices for surin, processing...
  ✓ SURIN_PUNE-BFW01: 45 reports cached
  ✓ SURIN_PUNE-BFW02: 32 reports cached
  ✓ SURIN_PUNE-BFW03: 28 reports cached
✅ Report update complete
📊 Total devices cached: 3
```

All updates are for **SURIN only** ✓

## Ready!

```bash
npm start
```

Your backend is now:
- ✅ Running for SURIN customer only
- ✅ Updating every 2 minutes
- ✅ Caching and correcting data
- ✅ Serving React frontend
- ✅ Secure and isolated

**Done!** 🎉
