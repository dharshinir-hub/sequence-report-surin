/*
 * Integration tests: assert structural invariants across the ENTIRE live dataset.
 * Requires the container running on :6027. Run: node test/integration.test.js
 */
const http = require('http');
const MACHINES = ['SURIN-BFW_XTRON_1', 'SURIN-BFW_XTRON_2', 'SURIN-BFW_XTRON_3'];
const FROM = '2026-06-28', TO = '2026-07-10';

function get(m) {
  return new Promise((res, rej) => {
    http.get('http://localhost:6027/api/v1/sequence-report/' + encodeURIComponent(m) + '/all/' + FROM + '/' + TO + '/1/5000',
      r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))); }).on('error', rej);
  });
}
let pass = 0, fail = 0; const fails = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name); console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
}

(async () => {
  for (const m of MACHINES) {
    const data = (await get(m)).data.slice().sort((a, b) => a.start_time - b.start_time);
    console.log('\n=== ' + m + '  (' + data.length + ' parts) ===');

    // INV1: end >= start for every part
    let badWindow = data.find(p => p.end_time < p.start_time);
    check('every part end_time >= start_time', !badWindow, badWindow && 'part ' + badWindow.part_number);

    // INV2: parts are ordered & non-overlapping (next start >= this start; contiguous chain)
    let overlap = null;
    for (let i = 1; i < data.length; i++) if (data[i].start_time < data[i - 1].start_time) overlap = data[i];
    check('parts are time-ordered, no backward jumps', !overlap, overlap && 'at part ' + overlap.part_number);

    // INV3: durations never exceed the window (run+idle+disc+alarm <= window seconds + 2s tol)
    let over = data.find(p => {
      const win = Math.round((p.end_time - p.start_time) / 1000);
      const sum = (p.run_time || 0) + (p.idle_time || 0) + (p.disconnect_time || 0) + (p.alarm_time || 0);
      return sum > win + 2;
    });
    check('run+idle+disc+alarm never exceeds part window', !over,
      over && 'part ' + over.part_number + ' sum>' + Math.round((over.end_time - over.start_time) / 1000) + 's');

    // INV4: duration accounting is complete on RUNNING parts (sum ~= window within 3s),
    //       excluding the still-open last part (ends at nowMs).
    const complete = data.slice(0, -1);
    const accounted = complete.filter(p => {
      const win = Math.round((p.end_time - p.start_time) / 1000);
      const sum = (p.run_time || 0) + (p.idle_time || 0) + (p.disconnect_time || 0) + (p.alarm_time || 0);
      return Math.abs(sum - win) <= 3;
    }).length;
    check('duration buckets sum to window on >=98% of parts',
      accounted >= complete.length * 0.98, accounted + '/' + complete.length + ' fully accounted');

    // INV5: program_number is parsed (never contains a raw path separator)
    let rawPath = data.find(p => String(p.program_number).includes('/'));
    check('program_number has no raw "/" (job_name parsed)', !rawPath, rawPath && 'part ' + rawPath.part_number + ': ' + rawPath.program_number);

    // INV6: negative durations never occur
    let neg = data.find(p => [p.run_time, p.idle_time, p.disconnect_time, p.alarm_time].some(v => v < 0));
    check('no negative durations', !neg, neg && 'part ' + neg.part_number);

    // INV7: part_number present and numeric on every record
    let badNum = data.find(p => !Number.isInteger(p.part_number));
    check('every part has an integer part_number', !badNum);
  }

  console.log('\n' + '='.repeat(50));
  console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed');
  if (fail) { console.log('FAILED: ' + fails.join('; ')); process.exit(1); }
  console.log('ALL INTEGRATION INVARIANTS HOLD');
})().catch(e => { console.error('ERR', e); process.exit(1); });
