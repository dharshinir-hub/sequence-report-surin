const ThingsboardReportService = require('./thingsboardReportService');

class ScheduledReportUpdater {
  constructor() {
    this.reportService = new ThingsboardReportService();
    this.cachedReports = {}; // Cache for all reports

    // Read update interval from .env (in seconds, convert to milliseconds)
    const updateSeconds = parseInt(process.env.UPDATE_INTERVAL_SECONDS || '120');
    this.updateInterval = updateSeconds * 1000;

    // Read telemetry lookback from .env (in hours)
    this.telemetryLookbackHours = parseInt(process.env.TELEMETRY_LOOKBACK_HOURS || '24');

    this.lastUpdate = null;

    console.log(`⚙️  Configuration:`);
    console.log(`   Update interval: ${updateSeconds} second(s)`);
    console.log(`   Lookback period: ${this.telemetryLookbackHours} hour(s)`);
  }

  // Convert milliseconds to HH:MM:SS format
  msToHMS(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  // Check if a timestamp falls within a component's time range
  isTimeInRange(checkTime, startTime, endTime) {
    return checkTime >= startTime && checkTime <= endTime;
  }

  // Collect distinct telemetry values whose timestamp falls within [start, end],
  // in time order, joined with "||". Returns "-" when nothing falls in range.
  collectValuesInRange(telemetryData, startTime, endTime) {
    if (!telemetryData || telemetryData.length === 0) return '-';

    const inRange = telemetryData
      .map(entry => ({
        ts: Array.isArray(entry) ? entry[0] : entry.ts,
        value: Array.isArray(entry) ? entry[1] : entry.value
      }))
      .filter(e => e.ts >= startTime && e.ts <= endTime)
      .sort((a, b) => a.ts - b.ts);

    const unique = [];
    inRange.forEach(e => {
      let v = e.value;
      let skip = false;

      // For JSON objects: only extract alarm_message. If it doesn't exist, skip.
      if (typeof v === 'object' && v !== null) {
        if (v.alarm_message) {
          v = v.alarm_message;
        } else {
          skip = true; // Skip JSON objects without alarm_message
        }
      } else if (typeof v === 'string' && v.trim().startsWith('{')) {
        try {
          const obj = JSON.parse(v);
          if (obj.alarm_message) {
            v = obj.alarm_message;
          } else {
            skip = true; // Skip JSON strings without alarm_message
          }
        } catch (e) { /* keep raw string */ }
      }

      if (!skip) {
        v = String(v);
        if (v !== '' && !unique.includes(v)) unique.push(v);
      }
    });

    return unique.length > 0 ? unique.join('||') : '-';
  }

  // Get ALL components that overlap the part's time range, sorted by start_time
  // ascending (so the current/latest component is last). A single part can span
  // multiple components; each carries its own sequence list and time window.
  getComponentsForPartTime(liveComponentData, partStartTime, partEndTime) {
    if (!liveComponentData || liveComponentData.length === 0) {
      return [];
    }

    const components = [];

    liveComponentData.forEach(entry => {
      try {
        const compData = typeof entry.value === 'string' ? JSON.parse(entry.value) : entry.value;
        const compStart = compData.start_time;
        const compEnd = compData.end_time;

        // Check if part overlaps with this component's time range
        const partStartInComp = this.isTimeInRange(partStartTime, compStart, compEnd);
        const partEndInComp = this.isTimeInRange(partEndTime, compStart, compEnd);
        const compStartInPart = this.isTimeInRange(compStart, partStartTime, partEndTime);

        if (partStartInComp || partEndInComp || compStartInPart) {
          components.push({
            code: compData.code || '-',
            name: compData.name || 'No component',
            sequences: compData.sequences || [],
            start_time: compStart || 0,
            end_time: compEnd || 0
          });
        }
      } catch (e) {
        // Skip malformed entries
      }
    });

    // Sort by start_time ascending (earliest first, current/latest last)
    components.sort((a, b) => a.start_time - b.start_time);

    // Deduplicate the SAME component (same code) that was posted more than once
    // for this part. Merge their time windows so it appears just once. Different
    // components (different codes) are kept separate.
    const deduped = [];
    const byCode = new Map();
    components.forEach(comp => {
      if (byCode.has(comp.code)) {
        const existing = byCode.get(comp.code);
        existing.start_time = Math.min(existing.start_time, comp.start_time);
        existing.end_time = Math.max(existing.end_time, comp.end_time);
        // keep the richer sequence list if the existing one is empty
        if ((!existing.sequences || existing.sequences.length === 0) && comp.sequences) {
          existing.sequences = comp.sequences;
        }
      } else {
        const copy = { ...comp };
        byCode.set(comp.code, copy);
        deduped.push(copy);
      }
    });

    return deduped;
  }

  // Parse shift schedule - handles both string format and array of shift objects
  parseShiftSchedule(allShiftData) {
    if (!allShiftData) return [];

    const shifts = [];

    // Handle array of shift objects from ThingsBoard API
    if (Array.isArray(allShiftData)) {
      allShiftData.forEach(shift => {
        if (shift.start_time && shift.end_time) {
          // Extract hours from HH:MM:SS format
          const startHour = parseInt(shift.start_time.split(':')[0]);
          const endHour = parseInt(shift.end_time.split(':')[0]);
          shifts.push({ start: startHour, end: endHour });
        }
      });
      return shifts;
    }

    // Handle string format (e.g., "8-10, 10-14, 14-22, 22-6")
    const shiftString = typeof allShiftData === 'string' ? allShiftData : String(allShiftData);
    const shiftPairs = shiftString.split(',').map(s => s.trim());

    shiftPairs.forEach(pair => {
      const times = pair.split('-');
      if (times.length === 2) {
        const start = parseInt(times[0].trim());
        const end = parseInt(times[1].trim());
        shifts.push({ start, end });
      }
    });

    return shifts;
  }

  // Check if timestamp matches any shift start time
  isShiftStartTime(timestamp, shifts) {
    if (!shifts || shifts.length === 0) return false;

    const date = new Date(timestamp);
    const hour = date.getHours();

    return shifts.some(shift => shift.start === hour);
  }

  // Get operator info that matches the part's time range
  getOperatorForPartTime(liveOperatorData, partStartTime, partEndTime) {
    if (!liveOperatorData || liveOperatorData.length === 0) {
      return { code: '-', name: 'No operator' };
    }

    const operators = [];

    liveOperatorData.forEach(entry => {
      try {
        const opData = typeof entry.value === 'string' ? JSON.parse(entry.value) : entry.value;
        const opStart = opData.start_time;
        const opEnd = opData.end_time;

        // Check if part overlaps with this operator's time range
        const partStartInOp = this.isTimeInRange(partStartTime, opStart, opEnd);
        const partEndInOp = this.isTimeInRange(partEndTime, opStart, opEnd);
        const opStartInPart = this.isTimeInRange(opStart, partStartTime, partEndTime);

        if (partStartInOp || partEndInOp || opStartInPart) {
          operators.push({
            code: opData.code || '-',
            name: opData.name || 'No operator',
            start_time: opStart || 0
          });
        }
      } catch (e) {
        // Skip malformed entries
      }
    });

    if (operators.length === 0) {
      return { code: '-', name: 'No operator' };
    }

    // Sort by start_time ascending so the current (latest) operator is last (2nd place)
    operators.sort((a, b) => a.start_time - b.start_time);

    // Deduplicate the SAME operator (same code) posted more than once for this
    // part, so it isn't shown as "2||2". Different operators are kept separate.
    const seen = new Set();
    const uniqueOperators = operators.filter(o => {
      if (seen.has(o.code)) return false;
      seen.add(o.code);
      return true;
    });

    // Merge multiple operators with || (current/latest one appears last)
    return {
      code: uniqueOperators.map(o => o.code).join('||'),
      name: uniqueOperators.map(o => o.name).join('||')
    };
  }

  // Build the full sequence_detail for a part. A part may overlap several
  // components (each with its own sequence list and time window); the detail is
  // the concatenation of each component's sequence records, in time order.
  //   - no overlapping component        -> [] (just durations on the part)
  //   - each component window is built independently against its own seq list
  //   - a component whose window ends before/at the part end (or is followed by
  //     another component, or whose part is complete) is "closed": its running
  //     sequence is finalized and remaining sequences are marked Skipped
  buildSequenceDetail(componentsInPart, deviceSeqData, partStartTime, partEndTime, isPartComplete = false, machineStatus = [], liveAlarm = []) {
    if (!componentsInPart || componentsInPart.length === 0) {
      return [];
    }

    // Parse device sequence_number readings within the whole part's time range
    let readings = [];
    if (deviceSeqData && deviceSeqData.length > 0) {
      readings = deviceSeqData
        .map(entry => {
          const ts = Array.isArray(entry) ? entry[0] : entry.ts;
          const value = parseInt(Array.isArray(entry) ? entry[1] : entry.value);
          return { ts, value };
        })
        .filter(r => !isNaN(r.value))
        .sort((a, b) => a.ts - b.ts);
    }

    let detail = [];

    for (let c = 0; c < componentsInPart.length; c++) {
      const comp = componentsInPart[c];

      // Effective window of this component within the part
      const windowStart = Math.max(partStartTime, comp.start_time);
      const windowEnd = Math.min(partEndTime, comp.end_time);
      if (windowEnd <= windowStart) continue; // no real overlap

      const isLastComp = (c === componentsInPart.length - 1);

      // Close this component if: another component follows it, OR it ends within
      // the part, OR the part itself is complete. Only a still-running last
      // component of the active part is left open (Running).
      const closeAtEnd = !isLastComp || comp.end_time <= partEndTime || isPartComplete;

      const compDetail = this.buildComponentSequenceDetail(
        comp.sequences,
        readings,
        windowStart,
        windowEnd,
        closeAtEnd,
        machineStatus,
        liveAlarm
      );

      detail = detail.concat(compDetail);
    }

    return detail;
  }

  // Build sequence records for ONE component window against its own sequence
  // list, tracking status from the device's sequence_number readings.
  //
  // Per reading (in time order):
  //   - close the currently active record (Unknown stays "Unknown", Rework keeps
  //     its "Rework-N" label, everything else becomes "Completed")
  //   - forward (sequence ahead): jumped-over sequences -> Skipped, match -> Running
  //   - known sequence already passed -> appended record: "Rework-N" if it was
  //     Completed before, otherwise "Running"
  //   - unknown sequence (not in list) -> skip remaining forward, append "Running"
  //     (closes later as "Unknown")
  // When the window is closed (closeAtEnd), the final record is finalized and any
  // remaining Pending sequences are marked Skipped. With no readings: active ->
  // single auto first record ("-" fields); closed -> all sequences Skipped.
  buildComponentSequenceDetail(sequences, allReadings, windowStart, windowEnd, closeAtEnd, machineStatus = [], liveAlarm = []) {
    if (!sequences || sequences.length === 0) {
      return [];
    }

    // Base records - all start as Pending
    const records = sequences.map((seq, index) => ({
      operation_sequence: parseInt(seq.sequence) || (index + 1),
      start: '-',
      end: '-',
      duration: 0,
      operation_status: 'Pending',
      planed_touch_time: this.parseTouchTime(seq.touch_time || '00:00:00'),
      actual_run: 0,
      actual_idle: 0,
      actual_disonnect: 0,
      actual_alarm: 0,
      total_seq_time: 0,
      message: '-',
      alarm: '-'
    }));

    // Device readings that fall inside this component's window
    const readings = allReadings.filter(r => r.ts >= windowStart && r.ts <= windowEnd);

    // No readings in this window
    if (readings.length === 0) {
      if (closeAtEnd) {
        // Component window finished without any sequence -> all Skipped
        records.forEach(r => { r.operation_status = 'Skipped'; });
        return records;
      }
      // Active component, nothing run yet -> auto first record, all fields "-"
      const first = sequences[0];
      return [{
        operation_sequence: parseInt(first.sequence) || 1,
        start: '-',
        end: '-',
        duration: '-',
        operation_status: '-',
        planed_touch_time: this.parseTouchTime(first.touch_time || '00:00:00'),
        actual_run: '-',
        actual_idle: '-',
        actual_disonnect: '-',
        actual_alarm: '-',
        total_seq_time: '-',
        message: '-',
        alarm: '-'
      }];
    }

    // Helper: fresh record for an appended (re-run / unknown) sequence value
    const makeRecord = (seqValue) => {
      const planned = sequences.find(s => (parseInt(s.sequence) || 0) === seqValue);
      return {
        operation_sequence: seqValue,
        start: '-',
        end: '-',
        duration: 0,
        operation_status: 'Pending',
        planed_touch_time: planned ? this.parseTouchTime(planned.touch_time || '00:00:00') : 0,
        actual_run: 0,
        actual_idle: 0,
        actual_disonnect: 0,
        actual_alarm: 0,
        total_seq_time: 0,
        message: '-',
        alarm: '-'
      };
    };

    // Helper: mark a record active (Running/Rework-N) until the window end
    const markActive = (rec, ts, status) => {
      rec.operation_status = status;
      rec.start = ts;
      rec.end = windowEnd;
      rec.duration = Math.round((windowEnd - ts) / 1000);
      rec.actual_run = rec.duration;
      rec.total_seq_time = rec.duration;
    };

    const isInList = (value) =>
      sequences.some(s => (parseInt(s.sequence) || 0) === value);

    let pointer = 0;             // forward position in the sequence list
    let maxReachedIndex = -1;    // furthest forward sequence reached
    let running = null;          // currently active record
    let runningKind = 'normal';  // 'normal' | 'unknown' | 'rework'
    const appended = [];         // re-run / unknown records
    const completedSeqs = new Set();
    const reworkCounts = new Map(); // sequence value -> rework count

    // Close the currently running record at the given timestamp
    const closeRunning = (endTs) => {
      if (!running) return;
      running.end = endTs;
      running.duration = Math.round((endTs - running.start) / 1000);
      running.actual_run = running.duration;
      running.total_seq_time = running.duration;
      if (runningKind === 'unknown') {
        running.operation_status = 'Unknown';
      } else if (runningKind === 'rework') {
        // keep the existing "Rework-N" label
      } else {
        running.operation_status = 'Completed';
        completedSeqs.add(running.operation_sequence);
      }
      running = null;
      runningKind = 'normal';
    };

    for (const reading of readings) {
      closeRunning(reading.ts);

      // Forward search from the current pointer
      let targetIndex = -1;
      for (let k = pointer; k < records.length; k++) {
        if (records[k].operation_sequence === reading.value) {
          targetIndex = k;
          break;
        }
      }

      if (targetIndex >= 0) {
        // Forward move: jumped-over sequences -> Skipped, matched -> Running
        for (let k = pointer; k < targetIndex; k++) {
          records[k].operation_status = 'Skipped';
        }
        markActive(records[targetIndex], reading.ts, 'Running');
        running = records[targetIndex];
        runningKind = 'normal';
        pointer = targetIndex + 1;
        if (targetIndex > maxReachedIndex) maxReachedIndex = targetIndex;
      } else if (isInList(reading.value)) {
        // Known sequence already passed -> going back skips any not-yet-reached
        // forward sequences, then the re-run is appended as a new record
        for (let k = pointer; k < records.length; k++) {
          records[k].operation_status = 'Skipped';
        }
        if (records.length - 1 > maxReachedIndex) maxReachedIndex = records.length - 1;
        pointer = records.length;

        if (completedSeqs.has(reading.value)) {
          const count = (reworkCounts.get(reading.value) || 0) + 1;
          reworkCounts.set(reading.value, count);
          const rec = makeRecord(reading.value);
          markActive(rec, reading.ts, `Rework-${count}`);
          running = rec;
          runningKind = 'rework';
          appended.push(rec);
        } else {
          const rec = makeRecord(reading.value);
          markActive(rec, reading.ts, 'Running');
          running = rec;
          runningKind = 'normal';
          appended.push(rec);
        }
      } else {
        // Unknown sequence -> skip remaining forward, append as Running
        for (let k = pointer; k < records.length; k++) {
          records[k].operation_status = 'Skipped';
        }
        if (records.length - 1 > maxReachedIndex) maxReachedIndex = records.length - 1;
        pointer = records.length;

        const rec = makeRecord(reading.value);
        markActive(rec, reading.ts, 'Running');
        running = rec;
        runningKind = 'unknown';
        appended.push(rec);
      }
    }

    // Window closed -> finalize the running record and skip the leftovers
    if (closeAtEnd) {
      closeRunning(windowEnd);
      for (let k = pointer; k < records.length; k++) {
        records[k].operation_status = 'Skipped';
      }
      if (records.length - 1 > maxReachedIndex) maxReachedIndex = records.length - 1;
    }

    // Output: forward sequences reached, plus appended re-run / unknown records
    let output = maxReachedIndex >= 0 ? records.slice(0, maxReachedIndex + 1) : [];
    output = output.concat(appended);

    if (output.length === 0) {
      const first = sequences[0];
      return [{
        operation_sequence: parseInt(first.sequence) || 1,
        start: '-',
        end: '-',
        duration: '-',
        operation_status: '-',
        planed_touch_time: this.parseTouchTime(first.touch_time || '00:00:00'),
        actual_run: '-',
        actual_idle: '-',
        actual_disonnect: '-',
        actual_alarm: '-',
        total_seq_time: '-',
        message: '-',
        alarm: '-'
      }];
    }

    // Enrich each materialized sequence (one with real numeric start/end) with:
    //   - alarm text from live_alarm within the sequence window (|| if multiple)
    //   - actual machine-status durations (run/idle/disconnect/alarm) in seconds
    //   - Incomplete status + "Network Off" message when it was disconnected
    output.forEach(rec => {
      if (typeof rec.start === 'number' && typeof rec.end === 'number') {
        rec.alarm = this.collectValuesInRange(liveAlarm, rec.start, rec.end);

        const d = this.calculateStatusDurations(machineStatus, rec.start, rec.end);
        rec.actual_run = Math.round(d.run_time / 1000);
        rec.actual_idle = Math.round(d.idle_time / 1000);
        rec.actual_disonnect = Math.round(d.disconnect_time / 1000);
        rec.actual_alarm = Math.round(d.alarm_time / 1000);

        // Any disconnect during the sequence marks it Incomplete (Network Off)
        if (rec.actual_disonnect > 0) {
          rec.operation_status = 'Incomplete';
          rec.message = 'Network Off';
        }
      }
    });

    return output;
  }

  // Parse touch time (HH:MM:SS) to seconds
  parseTouchTime(timeStr) {
    const parts = timeStr.split(':');
    return (parseInt(parts[0]) * 3600) + (parseInt(parts[1]) * 60) + parseInt(parts[2]);
  }

  // Calculate status durations for a part
  calculateStatusDurations(machineStatusData, startTime, endTime) {
    let run_time = 0, idle_time = 0, disconnect_time = 0, alarm_time = 0;

    if (!machineStatusData || machineStatusData.length === 0) {
      return { run_time, idle_time, disconnect_time, alarm_time };
    }

    // Parse status data into array of {ts, status}
    const statuses = machineStatusData.map(entry => {
      const ts = Array.isArray(entry) ? entry[0] : entry.ts;
      const status = parseInt(Array.isArray(entry) ? entry[1] : entry.value);
      return { ts, status };
    }).sort((a, b) => a.ts - b.ts);

    // Find status at or before startTime
    let currentStatus = null;
    let statusIndex = 0;

    for (let i = statuses.length - 1; i >= 0; i--) {
      if (statuses[i].ts <= startTime) {
        currentStatus = statuses[i];
        statusIndex = i;
        break;
      }
    }

    // If no status before start, use first available
    if (!currentStatus && statuses.length > 0) {
      currentStatus = statuses[0];
      statusIndex = 0;
    }

    if (!currentStatus) {
      return { run_time, idle_time, disconnect_time, alarm_time };
    }

    // Process status changes within the part timeframe
    let currentTime = startTime;
    let i = statusIndex;

    while (currentTime < endTime && i < statuses.length) {
      const nextStatusTime = i + 1 < statuses.length ? Math.min(statuses[i + 1].ts, endTime) : endTime;
      const duration = nextStatusTime - currentTime;

      // Accumulate duration based on status
      const status = currentStatus.status;
      if (status === 3) {
        run_time += duration;
      } else if (status === 0 || status === 2) {
        idle_time += duration;
      } else if (status === 5) {
        alarm_time += duration;
      } else if (status === 100) {
        disconnect_time += duration;
      }

      // Move to next status
      if (i + 1 < statuses.length && statuses[i + 1].ts <= endTime) {
        currentStatus = statuses[++i];
        currentTime = currentStatus.ts;
      } else {
        break;
      }
    }

    return { run_time, idle_time, disconnect_time, alarm_time };
  }

  // Start the scheduled updates
  start() {
    // Run immediately on start
    this.updateAllReports();

    // Then run every 2 minutes
    setInterval(() => {
      this.updateAllReports();
    }, this.updateInterval);
  }

  // Update all reports from all devices (for SURIN customer only)
  async updateAllReports() {
    try {
      const now = new Date();
      const customerId = process.env.CUSTOMER_ID;
      const customerName = process.env.CUSTOMER_NAME || 'surin';

      console.log(`\n⏱️  [${now.toLocaleTimeString()}] Updating SURIN devices...`);

      // Fetch customer attributes (for shift schedule)
      let shifts = [];
      try {
        const customerAttrs = await this.reportService.getCustomerAttributes(customerId);
        if (customerAttrs && customerAttrs.allShift) {
          shifts = this.parseShiftSchedule(customerAttrs.allShift);
          const shiftSummary = shifts.map(s => `${s.start}-${s.end}`).join(', ');
          console.log(`📋 Shift Schedule: ${shiftSummary}`);
        }
      } catch (e) {
        console.log(`⚠️  Could not fetch shift schedule: ${e.message}`);
      }

      // Get all devices for SURIN customer
      const devices = await this.reportService.getDevicesByCustomer(customerId);

      if (!devices || devices.length === 0) {
        console.log(`⚠️  No SURIN devices found`);
        return;
      }

      // For each device, fetch and cache its reports
      for (const device of devices) {
        try {
          const deviceId = device.id.id;
          const deviceName = device.name;

          // Fetch sequence report telemetry for configured lookback period
          const nowMs = Date.now();
          const lookbackMs = this.telemetryLookbackHours * 60 * 60 * 1000;
          const lookbackTime = nowMs - lookbackMs;

          const telemetry = await this.reportService.getDeviceTelemetry(
            deviceId,
            ['sequence_report', 'parts_count', 'live_component', 'live_operator', 'machine_status', 'sequence_number',
             'live_alarm', 'serial_number', 'programme_numberr', 'revision_no'],
            lookbackTime,
            nowMs
          );

          // Parse and cache reports
          const reports = [];

          // ALWAYS process parts_count first (it's the source of truth)
          // This ensures all parts are created/updated correctly
          if (telemetry.parts_count && telemetry.parts_count.length > 0) {
            // Sort parts_count by timestamp (ascending order)
            const sortedParts = [...telemetry.parts_count].sort((a, b) => {
              const tsA = Array.isArray(a) ? a[0] : a.ts;
              const tsB = Array.isArray(b) ? b[0] : b.ts;
              return tsA - tsB;
            });

            console.log(`  [DEBUG] parts_count for ${deviceName}: ${sortedParts.length} entries`);
            console.log(`  [DEBUG] sortedParts:`, sortedParts);
            console.log(`  [DEBUG] Shift schedule:`, shifts.map(s => `${s.start}-${s.end}`).join(', '));

            let previousPartIndex = -1;

            // Tracks serial/program/revision signatures seen per component, to
            // flag duplicate parts (same 3 identity values under one component)
            const componentSignatures = new Map();

            for (let i = 0; i < sortedParts.length; i++) {
              try {
                const entry = sortedParts[i];
                // Handle both array [ts, value] and object {ts, value} formats
                const startTime = Array.isArray(entry) ? entry[0] : entry.ts;
                const partValue = Array.isArray(entry) ? entry[1] : entry.value;
                const partNumber = !isNaN(parseInt(partValue)) ? parseInt(partValue) : (i + 1);

                // Check if this part number matches the previous part number
                let isSamePartNumber = false;
                if (previousPartIndex >= 0) {
                  const previousPartNumber = reports[previousPartIndex].data.part_number;
                  isSamePartNumber = (previousPartNumber === partNumber);
                }

                // Only check shift logic if SAME part number (continuation of same part across shift)
                if (isSamePartNumber) {
                  const isShiftStart = this.isShiftStartTime(startTime, shifts);

                  if (isShiftStart) {
                    // Update the previous part's end_time to this part's start_time
                    const previousReport = reports[previousPartIndex];
                    previousReport.data.end_time = startTime;
                    console.log(`  [DEBUG] Part ${partNumber} @ shift start 10:00 - extending previous part ${previousReport.data.part_number} end_time to ${startTime}`);
                    continue; // Skip creating a new record for this part
                  }
                }

                // A part is complete when a later part exists; the last part is
                // still active (ongoing), so end_time = current time for it.
                const isPartComplete = i < sortedParts.length - 1;

                // end_time = next part's start_time, or current time for last part
                const endTime = isPartComplete
                  ? (Array.isArray(sortedParts[i + 1]) ? sortedParts[i + 1][0] : sortedParts[i + 1].ts)
                  : nowMs;

                console.log(`  [DEBUG] Building report for part ${partNumber}, startTime=${startTime}, endTime=${endTime}`);

                // Get ALL components overlapping this part (sorted by time), and
                // the operator, based on time-range matching
                const componentsInPart = this.getComponentsForPartTime(
                  telemetry.live_component,
                  startTime,
                  endTime
                );

                // component_no / component_name join all overlapping components
                // (earliest first, current/latest last)
                const componentInfo = componentsInPart.length > 0
                  ? {
                      code: componentsInPart.map(c => c.code).join('||'),
                      name: componentsInPart.map(c => c.name).join('||')
                    }
                  : { code: '-', name: 'No component' };

                const operatorInfo = this.getOperatorForPartTime(
                  telemetry.live_operator,
                  startTime,
                  endTime
                );

                // Build sequence_detail across all overlapping components,
                // tracking status against the device's sequence_number stream
                const sequenceDetail = this.buildSequenceDetail(
                  componentsInPart,
                  telemetry.sequence_number,
                  startTime,
                  endTime,
                  isPartComplete,
                  telemetry.machine_status,
                  telemetry.live_alarm
                );

                // Calculate machine status durations for this part
                const statusDurations = this.calculateStatusDurations(
                  telemetry.machine_status,
                  startTime,
                  endTime
                );

                // Collect serial_number / program_number / revision_no values
                // posted within this part's window (joined with || if multiple)
                const serialNumber = this.collectValuesInRange(telemetry.serial_number, startTime, endTime);
                const programNumber = this.collectValuesInRange(telemetry.programme_numberr, startTime, endTime);
                const revisionNo = this.collectValuesInRange(telemetry.revision_no, startTime, endTime);

                // component_status: "duplicate" when the same serial/program/
                // revision triple already appeared under the SAME component;
                // uniqueness is scoped per component (same values under another
                // component are ignored).
                let componentStatus = 'NEW';
                const hasIdentity = serialNumber !== '-' || programNumber !== '-' || revisionNo !== '-';
                if (componentInfo.code !== '-' && hasIdentity) {
                  const signature = `${serialNumber}|${programNumber}|${revisionNo}`;
                  if (!componentSignatures.has(componentInfo.code)) {
                    componentSignatures.set(componentInfo.code, new Set());
                  }
                  const sigSet = componentSignatures.get(componentInfo.code);
                  if (sigSet.has(signature)) {
                    componentStatus = 'duplicate';
                  } else {
                    sigSet.add(signature);
                  }
                }

                // Generate complete report from parts_count with component/operator from time-range matching
                const reportObj = {
                  actual_part: 0,
                  part_number: partNumber,
                  start_time: startTime,
                  end_time: endTime,
                  machine_name: deviceName,
                  operator_no: operatorInfo.code,
                  operator_name: operatorInfo.name,
                  component_no: componentInfo.code,
                  component_name: componentInfo.name,
                  serial_number: serialNumber,
                  program_number: programNumber,
                  revision_no: revisionNo,
                  setup_number: '-',
                  component_status: componentStatus,
                  part_message: '-',
                  run_time: statusDurations.run_time,
                  idle_time: statusDurations.idle_time,
                  disconnect_time: statusDurations.disconnect_time,
                  alarm_time: statusDurations.alarm_time,
                  sequence_detail: sequenceDetail
                };

                // POST processed sequence_report back to ThingsBoard with part's start_time as ts
                const posted = await this.reportService.postDeviceTelemetry(
                  deviceId,
                  'sequence_report',
                  reportObj,
                  startTime
                );

                if (posted) {
                  // Log POST success
                } else {
                  console.log(`    ⚠️  Failed to POST part ${partNumber}`);
                }

                reports.push({
                  ts: startTime,
                  data: reportObj,
                  device_id: deviceId,
                  device_name: deviceName,
                  date: new Date(startTime).toISOString().split('T')[0]
                });
                previousPartIndex = reports.length - 1; // Track this part for potential extension
                console.log(`  [DEBUG] Created report for part ${partNumber}: start=${startTime}, end=${endTime}`);
              } catch (e) {
                console.log(`  [DEBUG] Error processing part: ${e.message}`);
              }
            }
          }
          // Fallback: If no parts_count, try sequence_report
          else if (telemetry.sequence_report && telemetry.sequence_report.length > 0) {
            telemetry.sequence_report.forEach(entry => {
              try {
                const ts = Array.isArray(entry) ? entry[0] : entry.ts;
                const value = Array.isArray(entry) ? entry[1] : entry.value;
                const reportObj = typeof value === 'string' ? JSON.parse(value) : value;

                reports.push({
                  ts,
                  data: reportObj,
                  device_id: deviceId,
                  device_name: deviceName,
                  date: new Date(ts).toISOString().split('T')[0]
                });
              } catch (e) {
                // Skip malformed entries
              }
            });
          }

          // Cache reports for this device
          this.cachedReports[deviceId] = {
            device_name: deviceName,
            reports,
            last_updated: nowMs,
            count: reports.length
          };

          // Show what data type was processed
          let dataType = 'sequence_report';
          if (!telemetry.sequence_report || telemetry.sequence_report.length === 0) {
            dataType = 'parts_count (processed)';
          }

          console.log(`  ✓ ${deviceName}: ${reports.length} ${dataType}`);
        } catch (error) {
          console.log(`  ✗ ${device.name}: error`);
        }
      }

      this.lastUpdate = now;
      console.log(`✅ Updated at ${now.toLocaleTimeString()}\n`);
    } catch (error) {
      console.error('Error:', error.message);
    }
  }

  // Get cached report for a machine in time range
  getReportsByMachine(machine, shiftNo, fromTime, toTime, page = 0, limit = 10) {
    try {
      // Find device by name
      let deviceId = Object.keys(this.cachedReports).find(
        id => this.cachedReports[id].device_name === machine
      );

      if (!deviceId) {
        // Try case-insensitive match
        deviceId = Object.keys(this.cachedReports).find(
          id => this.cachedReports[id].device_name.toLowerCase() === machine.toLowerCase()
        );
      }

      if (!deviceId) {
        return { message: 'Gopal', data: [], Page: page + 1, pagecount: limit, totalReports: 0 };
      }

      const cached = this.cachedReports[deviceId];
      const fromTimestamp = parseInt(fromTime);
      const toTimestamp = parseInt(toTime);

      // Filter reports by time range
      let filteredReports = cached.reports.filter(r => r.ts >= fromTimestamp && r.ts <= toTimestamp);

      // Transform for frontend
      const reportData = filteredReports.map(r => ({
        date: r.date,
        machine: r.device_name,
        shift: shiftNo,
        operator_id: r.data.operator_no || '-',
        operator_name: r.data.operator_name || 'No operator',
        component_number: r.data.component_no || '-',
        component_name: r.data.component_name || 'No component',
        target: 1,
        actual: r.data.actual_part || 0,
        palet_num: '1',
        palet_detail: [],
        reject: 0,
        rework: 0,
        efficiency: 0,
        utilisation: ((r.data.run_time || 0) * 100 / ((r.data.run_time || 0) + (r.data.idle_time || 0) + (r.data.disconnect_time || 0))).toFixed(2),
        run_time: Math.floor((r.data.run_time || 0) / 1000),
        idle_time: Math.floor((r.data.idle_time || 0) / 1000),
        disconnect_time: Math.floor((r.data.disconnect_time || 0) / 1000),
        duration: Math.floor(((r.data.run_time || 0) + (r.data.idle_time || 0) + (r.data.disconnect_time || 0)) / 1000)
      }));

      // Pagination
      const totalReports = reportData.length;
      const startIdx = page * limit;
      const endIdx = startIdx + limit;
      const paginatedData = reportData.slice(startIdx, endIdx);

      return {
        message: 'Gopal',
        data: paginatedData,
        Page: page + 1,
        pagecount: limit,
        totalReports
      };
    } catch (error) {
      console.error('Error getting cached reports:', error.message);
      return { message: 'Gopal', data: [], Page: page + 1, pagecount: limit, totalReports: 0 };
    }
  }

  // Get part report from cache - returns complete sequence report format
  getPartReportByMachine(machine, shiftNo, fromTime, toTime, page = 0, limit = 10) {
    try {
      const fromTimestamp = parseInt(fromTime);
      const toTimestamp = parseInt(toTime);

      // "All Machines" sends multiple device names comma-separated -> support a list
      const machineNames = String(machine)
        .split(',')
        .map(m => m.trim())
        .filter(m => m.length > 0);

      let reportData = [];

      machineNames.forEach(name => {
        // Find this device by exact name, else case-insensitive
        let deviceId = Object.keys(this.cachedReports).find(
          id => this.cachedReports[id].device_name === name
        );
        if (!deviceId) {
          deviceId = Object.keys(this.cachedReports).find(
            id => this.cachedReports[id].device_name.toLowerCase() === name.toLowerCase()
          );
        }
        if (!deviceId) {
          return; // unknown machine name -> skip
        }

        const cached = this.cachedReports[deviceId];
        cached.reports.forEach(r => {
          if (r.ts >= fromTimestamp && r.ts <= toTimestamp) {
            // Return complete report with sequence_detail as-is
            reportData.push({
              actual_part: r.data.actual_part || 0,
              part_number: r.data.part_number,
              start_time: r.data.start_time,
              end_time: r.data.end_time,
              machine_name: r.data.machine_name,
              operator_no: r.data.operator_no,
              operator_name: r.data.operator_name,
              component_no: r.data.component_no,
              component_name: r.data.component_name,
              serial_number: r.data.serial_number || '-',
              program_number: r.data.program_number || '-',
              revision_no: r.data.revision_no || '-',
              setup_number: r.data.setup_number || '-',
              component_status: r.data.component_status || 'NEW',
              part_message: r.data.part_message || '-',
              run_time: Math.round((r.data.run_time || 0) / 1000),
              idle_time: Math.round((r.data.idle_time || 0) / 1000),
              disconnect_time: Math.round((r.data.disconnect_time || 0) / 1000),
              alarm_time: Math.round((r.data.alarm_time || 0) / 1000),
              sequence_detail: r.data.sequence_detail || []
            });
          }
        });
      });

      // Sort by timestamp descending (newest/current part first)
      reportData.sort((a, b) => b.start_time - a.start_time);

      // Pagination
      const totalReports = reportData.length;
      const startIdx = page * limit;
      const endIdx = startIdx + limit;
      const paginatedData = reportData.slice(startIdx, endIdx);

      return {
        message: 'Gopal',
        data: paginatedData,
        Page: page + 1,
        pagecount: limit,
        totalReports,
        // aliases the frontend pagination reads (total / totalCount)
        total: totalReports,
        totalCount: totalReports
      };
    } catch (error) {
      console.error('Error getting part report:', error.message);
      return { message: 'Gopal', data: [], Page: page + 1, pagecount: limit, totalReports: 0, total: 0, totalCount: 0 };
    }
  }

  // Get cache status
  getStatus() {
    return {
      last_updated: this.lastUpdate,
      update_interval: `${this.updateInterval / 1000 / 60} minutes`,
      devices_cached: Object.keys(this.cachedReports).length,
      devices: Object.keys(this.cachedReports).map(id => ({
        id,
        name: this.cachedReports[id].device_name,
        reports_count: this.cachedReports[id].count,
        last_updated: this.cachedReports[id].last_updated
      }))
    };
  }

  // Clear cache
  clearCache() {
    this.cachedReports = {};
    console.log('🗑️  Cache cleared');
  }
}

module.exports = ScheduledReportUpdater;
