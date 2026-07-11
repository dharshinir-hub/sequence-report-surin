/*
 * QA test suite for the Sequence Report logic (pure functions).
 * Run: node test/sequenceReport.test.js
 * Each case has a synthetic input with a hand-computed expected output.
 */
const ScheduledReportUpdater = require('../src/scheduledReportUpdater');
const U = new ScheduledReportUpdater();

let pass = 0, fail = 0; const failures = [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function check(name, actual, expected) {
  if (eq(actual, expected)) { pass++; console.log('  ✓ ' + name); }
  else { fail++; failures.push(name); console.log('  ✗ ' + name + '\n      expected: ' + JSON.stringify(expected) + '\n      actual:   ' + JSON.stringify(actual)); }
}
const suite = t => console.log('\n=== ' + t + ' ===');

// IST helper: a timestamp that reads as HH:MM:SS in IST (UTC+5:30)
const istTs = (H, M, S = 0) => Date.UTC(2026, 6, 9, H, M, S) - 5.5 * 3600000;
const SHIFTS = [{ start: 8, end: 20 }, { start: 20, end: 8 }];

// ---------------------------------------------------------------------------
suite('isShiftStartTime  (shift starts 08:00 & 20:00 IST)');
check('08:00:00 IST -> true (shift 1 boundary)', U.isShiftStartTime(istTs(8, 0, 0), SHIFTS), true);
check('08:00:45 IST -> true (within boundary minute)', U.isShiftStartTime(istTs(8, 0, 45), SHIFTS), true);
check('20:00:00 IST -> true (shift 2 boundary)', U.isShiftStartTime(istTs(20, 0, 0), SHIFTS), true);
check('08:01:00 IST -> false (past the minute)', U.isShiftStartTime(istTs(8, 1, 0), SHIFTS), false);
check('13:56:35 IST -> false (regression: was wrongly skipped)', U.isShiftStartTime(istTs(13, 56, 35), SHIFTS), false);
check('02:03:30 IST -> false (regression: was wrongly skipped)', U.isShiftStartTime(istTs(2, 3, 30), SHIFTS), false);
check('14:00:00 IST -> false (not a shift start)', U.isShiftStartTime(istTs(14, 0, 0), SHIFTS), false);
check('empty shifts -> false', U.isShiftStartTime(istTs(8, 0, 0), []), false);

// ---------------------------------------------------------------------------
suite('calculateStatusDurations  (returns milliseconds; 3=run 0/2=idle 5=alarm 100=disc)');
check('run then idle then run',
  U.calculateStatusDurations([{ ts: 0, value: 3 }, { ts: 100000, value: 0 }, { ts: 150000, value: 3 }], 0, 200000),
  { run_time: 150000, idle_time: 50000, disconnect_time: 0, alarm_time: 0 });
check('disconnect only', U.calculateStatusDurations([{ ts: 0, value: 100 }], 0, 10000),
  { run_time: 0, idle_time: 0, disconnect_time: 10000, alarm_time: 0 });
check('alarm only (status 5)', U.calculateStatusDurations([{ ts: 0, value: 5 }], 0, 5000),
  { run_time: 0, idle_time: 0, disconnect_time: 0, alarm_time: 5000 });
check('status starting BEFORE window is carried in', U.calculateStatusDurations([{ ts: -50000, value: 3 }, { ts: 60000, value: 0 }], 0, 100000),
  { run_time: 60000, idle_time: 40000, disconnect_time: 0, alarm_time: 0 });
check('status 2 counts as idle', U.calculateStatusDurations([{ ts: 0, value: 2 }], 0, 8000),
  { run_time: 0, idle_time: 8000, disconnect_time: 0, alarm_time: 0 });
check('empty status -> all zero', U.calculateStatusDurations([], 0, 1000),
  { run_time: 0, idle_time: 0, disconnect_time: 0, alarm_time: 0 });

// ---------------------------------------------------------------------------
suite('collectValuesInRange');
check('joins distinct in-window values with ||', U.collectValuesInRange([{ ts: 10, value: 'A' }, { ts: 20, value: 'B' }], 0, 100), 'A||B');
check('excludes out-of-window', U.collectValuesInRange([{ ts: 10, value: 'A' }, { ts: 200, value: 'B' }], 0, 100), 'A');
check('dedupes repeats', U.collectValuesInRange([{ ts: 10, value: 'A' }, { ts: 20, value: 'A' }], 0, 100), 'A');
check('collapses padding whitespace', U.collectValuesInRange([{ ts: 10, value: 'X       Y' }], 0, 100), 'X Y');
check('nothing in window -> "-"', U.collectValuesInRange([{ ts: 200, value: 'A' }], 0, 100), '-');
check('extracts alarm_message from JSON', U.collectValuesInRange([{ ts: 10, value: '{"alarm_message":"ERR-1"}' }], 0, 100), 'ERR-1');

// ---------------------------------------------------------------------------
suite('lastValueBefore  (carry-forward)');
check('returns most recent before ts', U.lastValueBefore([{ ts: 10, value: 'A' }, { ts: 20, value: 'B' }], 25), 'B');
check('respects the ts boundary', U.lastValueBefore([{ ts: 10, value: 'A' }, { ts: 20, value: 'B' }], 15), 'A');
check('nothing before -> "-"', U.lastValueBefore([{ ts: 10, value: 'A' }], 5), '-');
check('collapses whitespace', U.lastValueBefore([{ ts: 10, value: 'P   Q' }], 50), 'P Q');
check('empty -> "-"', U.lastValueBefore([], 50), '-');

// ---------------------------------------------------------------------------
suite('isTimeInRange');
check('inside', U.isTimeInRange(50, 0, 100), true);
check('lower inclusive', U.isTimeInRange(0, 0, 100), true);
check('upper inclusive', U.isTimeInRange(100, 0, 100), true);
check('outside', U.isTimeInRange(150, 0, 100), false);

// ---------------------------------------------------------------------------
suite('parseShiftSchedule');
check('parses allShift objects', U.parseShiftSchedule([
  { start_time: '08:00:00', end_time: '20:00:00' }, { start_time: '20:00:00', end_time: '08:00:00' }]),
  [{ start: 8, end: 20 }, { start: 20, end: 8 }]);
check('parses string form', U.parseShiftSchedule('8-20, 20-8'), [{ start: 8, end: 20 }, { start: 20, end: 8 }]);

// ---------------------------------------------------------------------------
suite('parseTouchTime  (HH:MM:SS -> seconds)');
check('40 seconds', U.parseTouchTime('00:00:40'), 40);
check('7 minutes', U.parseTouchTime('00:07:00'), 420);
check('1h 2m 3s', U.parseTouchTime('01:02:03'), 3723);

// ---------------------------------------------------------------------------
suite('getOperatorForPartTime  (most-recent-before + handovers)');
const op = (code, s, e) => ({ value: JSON.stringify({ code, name: 'op' + code, start_time: s, end_time: e }) });
check('single operator spanning window', U.getOperatorForPartTime([op('A', 0, 1000)], 200, 800).code, 'A');
check('handover: prior + one starting during -> A||B',
  U.getOperatorForPartTime([op('A', 0, 1000), op('B', 500, 1000)], 200, 800).code, 'A||B');
check('stale prior dropped, keep most recent before start',
  U.getOperatorForPartTime([op('A', 0, 1000), op('B', 100, 1000)], 200, 800).code, 'B');
check('no overlap -> "-"', U.getOperatorForPartTime([op('A', 0, 100)], 200, 800).code, '-');

// ---------------------------------------------------------------------------
suite('getComponentsForPartTime  (overlap + dedup + window clip)');
const comp = (code, s, e) => ({ value: JSON.stringify({ code, name: 'c' + code, sequences: [], start_time: s, end_time: e }) });
check('single component -> [code]', U.getComponentsForPartTime([comp('C1', 0, 1000)], 200, 800).map(c => c.code), ['C1']);
check('same code posted twice -> merged to one', U.getComponentsForPartTime([comp('C1', 0, 500), comp('C1', 400, 1000)], 200, 800).map(c => c.code), ['C1']);
check('component change during part -> both, in order',
  U.getComponentsForPartTime([comp('C1', 0, 1000), comp('C2', 500, 1000)], 200, 800).map(c => c.code), ['C1', 'C2']);
check('expired component is not carried into a later part',
  U.getComponentsForPartTime([comp('C1', 0, 100)], 200, 800).map(c => c.code), []);

// ---------------------------------------------------------------------------
suite('buildComponentSequenceDetail  (sequence tracking)');
const seqs = [{ sequence: 1, touch_time: '00:00:40' }, { sequence: 2, touch_time: '00:00:40' }, { sequence: 3, touch_time: '00:00:40' }];
const statusOf = d => d.map(r => r.operation_sequence + ':' + r.operation_status);
check('forward 1->2->3 all Completed at close',
  statusOf(U.buildComponentSequenceDetail(seqs, [{ ts: 10, value: 1 }, { ts: 20, value: 2 }, { ts: 30, value: 3 }], 0, 100, true)),
  ['1:Completed', '2:Completed', '3:Completed']);
check('skipped middle sequence',
  statusOf(U.buildComponentSequenceDetail(seqs, [{ ts: 10, value: 1 }, { ts: 30, value: 3 }], 0, 100, true)),
  ['1:Completed', '2:Skipped', '3:Completed']);
check('no readings + closeAtEnd -> all Skipped',
  statusOf(U.buildComponentSequenceDetail(seqs, [], 0, 100, true)),
  ['1:Skipped', '2:Skipped', '3:Skipped']);

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(50));
console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed  (' + (pass + fail) + ' total)');
if (fail) { console.log('FAILED: ' + failures.join('; ')); process.exit(1); }
console.log('ALL TESTS PASSED');
