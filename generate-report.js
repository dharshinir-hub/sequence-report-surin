/**
 * Generate sequence report CSV(s) for a manually given start/end time.
 *
 * Usage:
 *   node generate-report.js <startTime> <endTime> [machine]
 *
 * Examples:
 *   node generate-report.js 2026-07-27 2026-07-28
 *   node generate-report.js "2026-07-27 09:00:00" "2026-07-27 17:30:00"
 *   node generate-report.js 2026-07-27 2026-07-28 SURIN-BFW_XTRON_1
 *
 * Dates without a time default to 00:00:00 (start) / 23:59:59 (end), IST.
 * If [machine] is omitted, one CSV is generated per device under CUSTOMER_ID.
 * Fetches sequence_report telemetry directly from ThingsBoard, so it does not
 * depend on the API server's in-memory cache/lookback window.
 */

const fs = require('fs');
const path = require('path');
const ThingsboardReportService = require('./src/thingsboardReportService');

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
  console.error('Usage: node generate-report.js <startTime> <endTime> [machine]');
  console.error('Example: node generate-report.js 2026-07-27 2026-07-28');
  console.error('Example: node generate-report.js "2026-07-27 09:00:00" "2026-07-27 17:30:00" SURIN-BFW_XTRON_1');
  process.exit(1);
}

const [startArg, endArg, machineArg] = args;

function parseStart(input) {
  const hasTime = input.includes('T') || input.includes(' ') && /\d{2}:\d{2}/.test(input);
  const normalized = input.trim().replace(' ', 'T');
  const withTime = hasTime ? normalized : `${normalized}T00:00:00`;
  return new Date(`${withTime}+05:30`).getTime();
}

function parseEnd(input) {
  const hasTime = input.includes('T') || input.includes(' ') && /\d{2}:\d{2}/.test(input);
  const normalized = input.trim().replace(' ', 'T');
  const withTime = hasTime ? normalized : `${normalized}T23:59:59`;
  return new Date(`${withTime}+05:30`).getTime();
}

const fromTs = parseStart(startArg);
const toTs = parseEnd(endArg);

if (isNaN(fromTs) || isNaN(toTs)) {
  console.error('❌ Could not parse start/end time. Use YYYY-MM-DD or "YYYY-MM-DD HH:mm:ss".');
  process.exit(1);
}

// seconds -> HH:MM:SS
const hms = (s) => {
  const n = Number(s);
  if (isNaN(n)) return '00:00:00';
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), sec = Math.round(n % 60);
  return [h, m, sec].map(v => String(v).padStart(2, '0')).join(':');
};
// epoch ms -> "DD-MM-YYYY HH:mm:ss"
const dateTime = (ms) => {
  const d = new Date(Number(ms));
  if (isNaN(d.getTime())) return '';
  const p = (v) => String(v).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
// epoch ms -> "HH:MM:SS" time-of-day
const timeOfDay = (ms) => {
  if (typeof ms !== 'number') return '-';
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '-';
  const p = (v) => String(v).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const num = (v) => {
  if (v === null || v === undefined || v === '' || v === '-') return '-';
  const n = Number(v);
  return isNaN(n) ? '-' : Math.round(n);
};
const fb = (v) => (v === null || v === undefined || v === '') ? '-' : v;
const cell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;

const HEADERS = [
  'S.no', 'Date & Time', 'Machine Name', 'Operator No', 'Operator Name',
  'Comp. Drawing No', 'Comp. Description', 'Comp. Serial No', 'Program No',
  'Revision No', 'Actual Part Count', 'Run Time', 'Idle Time', 'Disconnect Time',
  'Alarm Time', 'Component Status', 'Operation Sequence', 'Planned Touch Time',
  'Start Time', 'End Time', 'Actual Run Time', 'Operation Status', 'Alarm', 'Message'
];

function buildCsv(parts) {
  const rows = [HEADERS.map(cell).join(',')];

  const detailCols = (label, planned, start, end, run, status, alarm, message) => [
    label, fb(planned), timeOfDay(start), timeOfDay(end), num(run), fb(status), fb(alarm), fb(message)
  ];

  let sno = 0;
  parts.forEach(part => {
    sno += 1;
    const partBase = [
      sno,
      dateTime(part.start_time),
      fb(part.machine_name),
      fb(part.operator_no),
      fb(part.operator_name),
      fb(part.component_no),
      fb(part.component_name),
      fb(part.serial_number),
      fb(part.program_number),
      fb(part.revision_no),
      fb(part.part_number),
      hms(part.run_time),
      hms(part.idle_time),
      hms(part.disconnect_time),
      hms(part.alarm_time),
      fb(part.component_status)
    ];
    const blankBase = partBase.map(() => '');

    const details = Array.isArray(part.sequence_detail) ? part.sequence_detail : [];
    if (details.length === 0) {
      rows.push([...partBase, '', '', '', '', '', '', '', ''].map(cell).join(','));
    } else {
      let firstRow = true;
      details.forEach(seq => {
        const base = firstRow ? partBase : blankBase;
        firstRow = false;
        rows.push([...base, ...detailCols(
          'N' + seq.operation_sequence, seq.planed_touch_time, seq.start, seq.end,
          seq.actual_run, seq.operation_status, seq.alarm, seq.message
        )].map(cell).join(','));

        const balloons = Array.isArray(seq.balloon_seq) ? seq.balloon_seq : [];
        balloons.forEach(b => {
          rows.push([...blankBase, ...detailCols(
            'B' + b.balloon_seq, b.planned_touch_time, b.start, b.end,
            b.actual_run, b.balloon_status, b.alarm, b.message
          )].map(cell).join(','));
        });
      });
    }
  });

  return rows.join('\n');
}

async function fetchParts(reportService, device) {
  const telemetry = await reportService.getDeviceTelemetry(
    device.id.id,
    ['sequence_report'],
    fromTs,
    toTs
  );

  const entries = telemetry.sequence_report || [];
  const parts = entries.map(entry => {
    const ts = Array.isArray(entry) ? entry[0] : entry.ts;
    const value = Array.isArray(entry) ? entry[1] : entry.value;
    try {
      const data = typeof value === 'string' ? JSON.parse(value) : value;
      return {
        actual_part: data.actual_part || 0,
        part_number: data.part_number,
        start_time: data.start_time != null ? data.start_time : ts,
        end_time: data.end_time,
        machine_name: data.machine_name,
        operator_no: data.operator_no,
        operator_name: data.operator_name,
        component_no: data.component_no,
        component_name: data.component_name,
        serial_number: data.serial_number || '-',
        program_number: data.program_number || '-',
        revision_no: data.revision_no || '-',
        component_status: data.component_status || 'NEW',
        run_time: Math.round((data.run_time || 0) / 1000),
        idle_time: Math.round((data.idle_time || 0) / 1000),
        disconnect_time: Math.round((data.disconnect_time || 0) / 1000),
        alarm_time: Math.round((data.alarm_time || 0) / 1000),
        sequence_detail: data.sequence_detail || []
      };
    } catch (e) {
      return null;
    }
  }).filter(Boolean);

  parts.sort((a, b) => b.start_time - a.start_time);
  return parts;
}

async function main() {
  console.log(`\n🔄 Generating sequence report`);
  console.log(`   From: ${new Date(fromTs).toString()}`);
  console.log(`   To:   ${new Date(toTs).toString()}\n`);

  const reportService = new ThingsboardReportService();
  const allDevices = await reportService.getDevicesByCustomer(process.env.CUSTOMER_ID);

  if (!allDevices || allDevices.length === 0) {
    console.error('❌ No devices found for customer');
    process.exit(1);
  }

  const devices = machineArg
    ? allDevices.filter(d => d.name === machineArg || d.label === machineArg)
    : allDevices;

  if (devices.length === 0) {
    console.error(`❌ Machine "${machineArg}" not found. Available: ${allDevices.map(d => d.name).join(', ')}`);
    process.exit(1);
  }

  const outDir = __dirname;
  const stamp = (ms) => {
    const d = new Date(ms);
    const p = (v) => String(v).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const rangeLabel = `${stamp(fromTs)}_to_${stamp(toTs)}`;

  for (const device of devices) {
    process.stdout.write(`📊 ${device.name}... `);
    const parts = await fetchParts(reportService, device);
    const csv = buildCsv(parts);
    const filename = path.join(outDir, `Surin_Sequence_Report_${device.name}_${rangeLabel}.csv`);
    fs.writeFileSync(filename, csv);
    console.log(`${parts.length} parts -> ${path.basename(filename)}`);
  }

  console.log('\n✅ Done');
}

main().catch(err => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});
