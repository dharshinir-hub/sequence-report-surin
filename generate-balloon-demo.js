/**
 * Balloon demo data generator.
 *   - sequences numbered 11..20 (10 per part)
 *   - 5 balloons (1..5) per sequence
 *   - mixed Completed / Incomplete / Alarm / Skipped (+ a Running current part)
 *   - run / idle / disconnect / alarm durations populated and rolled up to part
 *   - message is ONLY "-" or "Network Off"; alarm carries the alarm text
 *
 * Run from the project folder:   node generate-balloon-demo.js
 * Posts to THINGSBOARD_REST_URL (.env) and writes ./balloon-demo-samples.json.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ---- Load .env -----------------------------------------------------------
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const idx = line.indexOf('=');
    if (idx === -1) return;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && value && !key.startsWith('#')) process.env[key] = value;
  });
}

const BASE_URL = process.env.THINGSBOARD_REST_URL;
const DEVICE_ID = 'e8232be0-42bc-11f1-b90a-090d117fd5a1'; // SURIN-BFW_XTRON_1
const MACHINE = 'SURIN-BFW_XTRON_1';

const SEC = 1000;
const MIN = 60 * SEC;
const BASE_TS = Date.UTC(2026, 5, 22, 2, 0, 0); // 2026-06-22 07:30 IST

const BAL_PLAN = 60;   // planned touch (s) per balloon
const SEQ_PLAN = 300;  // planned touch (s) per sequence
const SEQ_START = 11;  // sequences run 11..20
const SEQ_COUNT = 10;
const BALLOONS = 5;    // balloons 1..5 per sequence

const ALARMS = [
  'ALM-521 Coolant level low',
  'ALM-1043 Spindle overload',
  'ALM-275 Door interlock open',
  'ALM-880 Tool life expired'
];

const COMPONENTS = [
  { code: '3521', name: 'HYD HX30 LOWER MOTOR BKT' },
  { code: '5787', name: 'sample-ball' }
];
const OPERATORS = [
  { no: '125', name: 'AKASH PATEL' },
  { no: '121', name: 'OMKAR' }
];

const msgFor = (disc) => (disc > 0 ? 'Network Off' : '-');

// ---- balloon builders ----------------------------------------------------
function bMake(num, start, status, run, idle, disc, alarm, alarmText) {
  const dur = run + idle + disc + alarm;
  const end = start + dur * SEC;
  return {
    rec: {
      balloon_seq: num, start, end, duration: dur, balloon_status: status,
      planned_touch_time: BAL_PLAN, actual_run: run, actual_idle: idle,
      actual_disconnect: disc, actual_alarm: alarm, total_seq_time: dur,
      message: msgFor(disc), alarm: alarmText || '-'
    },
    end, run, idle, disc, alarm, alarmText: alarmText || null
  };
}
function bSkip(num) {
  return {
    rec: {
      balloon_seq: num, start: '-', end: '-', duration: 0, balloon_status: 'Skipped',
      planned_touch_time: BAL_PLAN, actual_run: 0, actual_idle: 0,
      actual_disconnect: 0, actual_alarm: 0, total_seq_time: 0, message: '-', alarm: '-'
    },
    end: null, run: 0, idle: 0, disc: 0, alarm: 0, alarmText: null
  };
}
function bPlaceholder(num) {
  return {
    rec: {
      balloon_seq: num, start: '-', end: '-', duration: '-', balloon_status: '-',
      planned_touch_time: BAL_PLAN, actual_run: '-', actual_idle: '-',
      actual_disconnect: '-', actual_alarm: '-', total_seq_time: '-', message: '-', alarm: '-'
    },
    end: null, run: 0, idle: 0, disc: 0, alarm: 0, alarmText: null
  };
}

// turn a balloon spec into a built balloon at the given clock
function buildBalloon(spec, num, clock) {
  switch (spec[0]) {
    case 'C':  return bMake(num, clock, 'Completed', 40, 20, 0, 0, null);
    case 'I':  return bMake(num, clock, 'Incomplete', 30, 15, 25, 0, null);
    case 'A':  return bMake(num, clock, 'Completed', 35, 10, 0, 20, ALARMS[spec[1] % ALARMS.length]);
    case 'AI': return bMake(num, clock, 'Incomplete', 25, 10, 20, 15, ALARMS[spec[1] % ALARMS.length]);
    case 'running': return bMake(num, clock, 'Running', 45, 30, 0, 0, null);
    case 'ph': return bPlaceholder(num);
    case 'skip':
    default:   return bSkip(num);
  }
}

// ---- sequence builder ----------------------------------------------------
function buildSeq(seqNum, clock, balloonSpecs) {
  let t = clock;
  const balloons = [];
  let firstStart = null, lastEnd = null, anyRunning = false;
  let run = 0, idle = 0, disc = 0, alarm = 0;
  const alarmTexts = [];

  balloonSpecs.forEach((spec, i) => {
    const b = buildBalloon(spec, i + 1, t);
    balloons.push(b.rec);
    if (b.end !== null) {
      if (firstStart === null) firstStart = b.rec.start;
      lastEnd = b.end; t = b.end;
      run += b.run; idle += b.idle; disc += b.disc; alarm += b.alarm;
      if (b.rec.balloon_status === 'Running') anyRunning = true;
      if (b.alarmText) alarmTexts.push(b.alarmText);
    }
  });

  // whole sequence never ran -> Skipped, no time window
  if (firstStart === null) {
    return {
      seq: {
        operation_sequence: seqNum, start: '-', end: '-', duration: 0,
        operation_status: 'Skipped', planed_touch_time: SEQ_PLAN,
        actual_run: 0, actual_idle: 0, actual_disonnect: 0, actual_alarm: 0,
        total_seq_time: 0, message: '-', alarm: '-', balloon_seq: balloons
      },
      clock
    };
  }

  const status = anyRunning ? 'Running' : (disc > 0 ? 'Incomplete' : 'Completed');
  const dur = Math.round((lastEnd - firstStart) / 1000);
  return {
    seq: {
      operation_sequence: seqNum, start: firstStart, end: lastEnd, duration: dur,
      operation_status: status, planed_touch_time: SEQ_PLAN,
      actual_run: run, actual_idle: idle, actual_disonnect: disc, actual_alarm: alarm,
      total_seq_time: dur, message: msgFor(disc),
      alarm: alarmTexts.length ? alarmTexts.join('||') : '-', balloon_seq: balloons
    },
    clock: lastEnd
  };
}

// ---- per-sequence balloon-spec variants (5 balloons each) -----------------
const VARIANTS = [
  (a) => [['C'], ['C'], ['C'], ['C'], ['C']],                 // all completed
  (a) => [['C'], ['C'], ['I'], ['skip'], ['skip']],           // incomplete + skips
  (a) => [['C'], ['A', a], ['C'], ['C'], ['skip']],           // alarm on b2
  (a) => [['skip'], ['skip'], ['skip'], ['skip'], ['skip']],  // whole seq skipped
  (a) => [['C'], ['A', a], ['I'], ['skip'], ['skip']],        // alarm + incomplete
  (a) => [['C'], ['C'], ['AI', a], ['skip'], ['skip']]        // disconnect-during-alarm
];

// ---- part builder --------------------------------------------------------
function buildPart(partNumber, partStart, partIdx, isRunning) {
  let clock = partStart;
  const sequences = [];

  for (let j = 0; j < SEQ_COUNT; j++) {
    const seqNum = SEQ_START + j;
    let specs;
    if (isRunning && j === SEQ_COUNT - 1) {
      specs = [['C'], ['C'], ['running'], ['ph'], ['ph']]; // current/running last seq
    } else {
      specs = VARIANTS[(j + partIdx) % VARIANTS.length](j + partIdx);
    }
    const { seq, clock: c } = buildSeq(seqNum, clock, specs);
    sequences.push(seq);
    clock = c; // no gap: the part window is fully sliced by run/idle/disc/alarm
  }

  const sum = (f) => sequences.reduce((a, s) => a + (typeof s[f] === 'number' ? s[f] : 0), 0);
  const comp = COMPONENTS[partIdx % COMPONENTS.length];
  const op = OPERATORS[partIdx % OPERATORS.length];

  return {
    actual_part: 0,
    part_number: partNumber,
    start_time: partStart,
    end_time: clock,
    machine_name: MACHINE,
    operator_no: op.no,
    operator_name: op.name,
    component_no: comp.code,
    component_name: comp.name,
    serial_number: '-',
    program_number: '-',
    revision_no: '-',
    setup_number: '-',
    component_status: 'NEW',
    part_message: '-',
    run_time: sum('actual_run'),
    idle_time: sum('actual_idle'),
    disconnect_time: sum('actual_disonnect'),
    alarm_time: sum('actual_alarm'),
    sequence_detail: sequences
  };
}

// build 10 parts, chained in time, last one is the running/current part
const records = [];
let cursor = BASE_TS;
for (let i = 0; i < 10; i++) {
  const rec = buildPart(471 + i, cursor, i, i === 9);
  records.push(rec);
  cursor = rec.end_time + 5 * MIN; // gap between parts
}

// ---- guard: message is only "-" / "Network Off" --------------------------
(function assertMessages() {
  const bad = [];
  records.forEach(r => {
    const ck = (m, w) => { if (m !== '-' && m !== 'Network Off') bad.push(`${w}: ${JSON.stringify(m)}`); };
    ck(r.part_message, `part ${r.part_number} part_message`);
    r.sequence_detail.forEach(s => {
      ck(s.message, `part ${r.part_number} seq ${s.operation_sequence}`);
      s.balloon_seq.forEach(b => ck(b.message, `part ${r.part_number} seq ${s.operation_sequence} b${b.balloon_seq}`));
    });
  });
  if (bad.length) { console.error('Bad messages:\n  ' + bad.join('\n  ')); process.exit(1); }
  console.log('message check OK (only "-" / "Network Off")');
})();

// ---- guard: run+idle+disc+alarm must slice the part window exactly --------
(function assertSlice() {
  const bad = [];
  records.forEach(r => {
    const windowSec = Math.round((r.end_time - r.start_time) / 1000);
    const sumSec = r.run_time + r.idle_time + r.disconnect_time + r.alarm_time;
    if (windowSec !== sumSec) {
      bad.push(`part ${r.part_number}: window ${windowSec}s != run+idle+disc+alarm ${sumSec}s`);
    }
  });
  if (bad.length) { console.error('Slice mismatch:\n  ' + bad.join('\n  ')); process.exit(1); }
  console.log('slice check OK (run+idle+disc+alarm == end-start for every part)');
})();

// ---- post ----------------------------------------------------------------
(async () => {
  const outFile = path.join(__dirname, 'balloon-demo-samples.json');
  fs.writeFileSync(outFile, JSON.stringify(records, null, 2));
  console.log(`Wrote ${records.length} records to ${outFile}`);
  console.log(`window: ${new Date(records[0].start_time).toISOString()} -> ${new Date(records[records.length - 1].end_time).toISOString()}`);

  if (!BASE_URL) { console.error('THINGSBOARD_REST_URL not set — wrote file only.'); return; }

  let token;
  try {
    token = (await axios.post(`${BASE_URL}/api/auth/login`, {
      username: process.env.THINGSBOARD_USER, password: process.env.THINGSBOARD_PASSWORD
    })).data.token;
  } catch (e) {
    console.error('Login failed:', e.response?.status, e.message, `(reachable? ${BASE_URL})`);
    return;
  }

  const H = { headers: { 'X-Authorization': `Bearer ${token}` } };

  // Clean prior demo rows in this window so re-runs don't pile up duplicates.
  // Real machine sequence_report rows fall outside the demo window, so they're safe.
  try {
    const delS = records[0].start_time - MIN;
    const delE = records[records.length - 1].end_time + MIN;
    await axios.delete(
      `${BASE_URL}/api/plugins/telemetry/DEVICE/${DEVICE_ID}/timeseries/delete?keys=sequence_report&startTs=${delS}&endTs=${delE}&deleteAllDataForKeys=false`,
      H
    );
    console.log('cleaned prior sequence_report rows in the demo window');
  } catch (e) {
    console.error('cleanup delete failed (continuing):', e.response?.status, e.message);
  }

  let ok = 0;
  for (const rec of records) {
    try {
      await axios.post(
        `${BASE_URL}/api/plugins/telemetry/DEVICE/${DEVICE_ID}/timeseries/values`,
        { ts: rec.start_time, values: { sequence_report: JSON.stringify(rec) } },
        H
      );
      ok++;
      console.log(`  posted part ${rec.part_number}  run/idle/disc/alarm=${rec.run_time}/${rec.idle_time}/${rec.disconnect_time}/${rec.alarm_time}`);
    } catch (e) {
      console.error(`  FAILED part ${rec.part_number}:`, e.response?.status, e.message);
    }
  }
  console.log(`Done: ${ok}/${records.length} records posted to ${MACHINE}.`);
})();
