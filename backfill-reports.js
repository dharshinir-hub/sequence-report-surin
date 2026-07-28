/**
 * Backfill sequence reports for a date range
 * Reprocesses telemetry and posts sequence_report back to ThingsBoard
 */

const fs = require('fs');
const path = require('path');
const ThingsboardReportService = require('./src/thingsboardReportService');
const ScheduledReportUpdater = require('./src/scheduledReportUpdater');

// Load .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value && !key.startsWith('#')) {
      process.env[key.trim()] = value.trim();
    }
  });
}

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node backfill-reports.js <startDate> <endDate>');
  console.error('Example: node backfill-reports.js 2026-07-11 2026-07-13');
  process.exit(1);
}

const startDateStr = args[0];
const endDateStr = args[1];

const startDate = new Date(startDateStr + 'T00:00:00+05:30');
const endDate = new Date(endDateStr + 'T23:59:59+05:30');

const startTs = startDate.getTime();
const endTs = endDate.getTime();

console.log(`\n🔄 Backfilling sequence reports`);
console.log(`   Period: ${startDateStr} to ${endDateStr}`);
console.log(`   Timestamps: ${startTs} to ${endTs}\n`);

async function backfill() {
  const reportService = new ThingsboardReportService();

  try {
    const customerId = process.env.CUSTOMER_ID;
    const devices = await reportService.getDevicesByCustomer(customerId);

    if (!devices || devices.length === 0) {
      console.log('❌ No devices found for customer');
      process.exit(1);
    }

    console.log(`✓ Found ${devices.length} devices\n`);

    let totalReportsPosted = 0;

    for (const device of devices) {
      const deviceId = device.id.id || device.id;
      const deviceName = device.name;

      console.log(`📊 Processing ${deviceName}...`);

      try {
        // Fetch sequence_report telemetry directly for the date range
        const telemetry = await reportService.getDeviceTelemetry(
          deviceId,
          ['sequence_report'],
          startTs,
          endTs
        );

        if (!telemetry.sequence_report || telemetry.sequence_report.length === 0) {
          console.log(`   ℹ️  No sequence_report data found for backfill period`);
          continue;
        }

        console.log(`   Found ${telemetry.sequence_report.length} sequence reports`);

        let reportsPosted = 0;

        // Iterate through all sequence reports and repost them
        for (const entry of telemetry.sequence_report) {
          try {
            const ts = Array.isArray(entry) ? entry[0] : entry.ts;
            const value = Array.isArray(entry) ? entry[1] : entry.value;

            // Parse report data
            const reportObj = typeof value === 'string' ? JSON.parse(value) : value;

            // Ensure it has required fields
            if (!reportObj.start_time) {
              reportObj.start_time = ts;
            }

            // POST to ThingsBoard
            const posted = await reportService.postDeviceTelemetry(
              deviceId,
              'sequence_report',
              reportObj,
              reportObj.start_time || ts
            );

            if (posted) {
              reportsPosted++;
              process.stdout.write('.');
            } else {
              process.stdout.write('x');
            }
          } catch (e) {
            process.stdout.write('E');
          }
        }

        console.log(`\n   ✓ Posted: ${reportsPosted}/${telemetry.sequence_report.length}\n`);
        totalReportsPosted += reportsPosted;

      } catch (error) {
        console.log(`   ❌ Error: ${error.message}\n`);
      }
    }

    console.log(`✅ Backfill complete!`);
    console.log(`   Total reports posted: ${totalReportsPosted}`);
    process.exit(0);

  } catch (error) {
    console.error('❌ Backfill failed:', error.message);
    process.exit(1);
  }
}

backfill();
