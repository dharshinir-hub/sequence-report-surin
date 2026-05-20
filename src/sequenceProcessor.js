class SequenceProcessor {
  constructor() {
    this.statusMap = {
      0: 'idle',
      1: 'idle',
      2: 'idle',
      3: 'running',
      5: 'alarm',
      100: 'disconnect'
    };
  }

  async processTrigger(payload, deviceStore, liveData, deviceId) {
    const ts = parseInt(payload.ts);
    const result = { closedPart: null, newPart: null, updatedPart: null };

    // Check if this is a parts_count trigger (new part)
    if (payload.hasOwnProperty('parts_count')) {
      const partNumber = payload.parts_count;

      if (deviceStore.activePart) {
        // Close previous part
        deviceStore.activePart.end_time = ts;
        deviceStore.activePart = this.finalizePart(
          deviceStore.activePart,
          liveData,
          ts
        );
        result.closedPart = deviceStore.activePart;
        deviceStore.completedParts.push(deviceStore.activePart);
      }

      // Create new part record
      deviceStore.activePart = this.createPartRecord(
        partNumber,
        ts,
        payload.deviceName,
        liveData
      );
      result.newPart = deviceStore.activePart;
    } else {
      // Other triggers update the active part
      if (deviceStore.activePart) {
        this.updatePartRecord(deviceStore.activePart, payload, liveData, ts);
        result.updatedPart = deviceStore.activePart;
      }
    }

    return result;
  }

  createPartRecord(partNumber, startTime, machineName, liveData) {
    return {
      actual_part: partNumber,
      start_time: startTime,
      end_time: null,
      machine_name: machineName,
      operator_no: '-',
      operator_name: 'No operator',
      component_no: '-',
      component_name: 'No component',
      serial_no: '-',
      program_number: '-',
      revision_number: '-',
      part_status: 'INPROGRESS',
      part_message: 'NEW',
      run_time: 0,
      idle_time: 0,
      stop_time: 0,
      network_f_time: 0,
      sequence_detail: [
        {
          value: 1, // First sequence
          start: null,
          end: null,
          duration: 0,
          operation_status: 'Skipped',
          planed_run_time: 0,
          actual_run: 0,
          actual_idle: 0,
          actual_stop: 0,
          network_f_time: 0,
          total_seq_time: 0,
          disconnect: false,
          message: '-',
          alarm: '-'
        }
      ]
    };
  }

  updatePartRecord(partRecord, payload, liveData, currentTs) {
    // Update operator based on time window
    if (!payload.operator_id) {
      const operator = this.findOperator(partRecord.start_time, currentTs, liveData);
      if (operator) {
        partRecord.operator_no = operator.code || '-';
        partRecord.operator_name = operator.name || 'No operator';
      }
    } else {
      partRecord.operator_no = payload.operator_id;
    }

    // Update component based on time window
    const component = this.findComponent(partRecord.start_time, currentTs, liveData);
    if (component) {
      partRecord.component_no = component.code || '-';
      partRecord.component_name = component.name || 'No component';
    }

    // Update from other payload keys
    if (payload.serial_no) partRecord.serial_no = payload.serial_no;
    if (payload.program_rev) partRecord.revision_number = payload.program_rev;
    if (payload.programe_numberr) partRecord.program_number = payload.programe_numberr;

    // Handle sequence number trigger
    if (payload.seq_no) {
      this.processSequenceTrigger(partRecord, payload.seq_no, component, currentTs, liveData);
    }
  }

  finalizePart(partRecord, liveData, endTime) {
    // Calculate timings from machine_status
    const machineStatus = this.parseMachineStatus(liveData.machine_status);
    const timings = this.calculateTimings(
      partRecord.start_time,
      endTime,
      machineStatus
    );

    partRecord.run_time = timings.run_time;
    partRecord.idle_time = timings.idle_time;
    partRecord.stop_time = timings.stop_time;
    partRecord.network_f_time = timings.network_f_time;

    // Update sequence details with timings
    partRecord.sequence_detail.forEach(seq => {
      if (seq.start && seq.end) {
        const seqTimings = this.calculateTimings(seq.start, seq.end, machineStatus);
        seq.actual_run = seqTimings.run_time;
        seq.actual_idle = seqTimings.idle_time;
        seq.actual_stop = seqTimings.stop_time;
        seq.network_f_time = seqTimings.network_f_time;
        seq.total_seq_time = seq.actual_run + seq.actual_idle + seq.actual_stop + seq.network_f_time;
        seq.duration = (seq.end - seq.start) / 1000; // Convert to seconds
      }
    });

    partRecord.part_status = 'COMPLETED';
    return partRecord;
  }

  processSequenceTrigger(partRecord, seqNo, component, currentTs, liveData) {
    const seqIndex = seqNo - 1;

    // Find the sequence in component sequences
    let plannedTouchTime = 0;
    let isKnownSequence = false;

    if (component && component.sequences) {
      const seq = component.sequences.find(s => parseInt(s.sequence) === seqNo);
      if (seq) {
        plannedTouchTime = this.parseTouchTime(seq.touch_time);
        isKnownSequence = true;
      }
    }

    // Create or update sequence record
    if (!partRecord.sequence_detail[seqIndex]) {
      // Create new sequence records for skipped sequences
      for (let i = partRecord.sequence_detail.length; i <= seqIndex; i++) {
        partRecord.sequence_detail.push({
          value: i + 1,
          start: null,
          end: null,
          duration: 0,
          operation_status: i < seqIndex ? 'Skipped' : isKnownSequence ? 'Running' : 'Unknown',
          planed_run_time: plannedTouchTime,
          actual_run: 0,
          actual_idle: 0,
          actual_stop: 0,
          network_f_time: 0,
          total_seq_time: 0,
          disconnect: false,
          message: '-',
          alarm: '-'
        });
      }
    }

    const seqRecord = partRecord.sequence_detail[seqIndex];
    seqRecord.start = currentTs;
    seqRecord.operation_status = isKnownSequence ? 'Running' : 'Unknown';
  }

  findOperator(partStartTime, currentTime, liveData) {
    if (!liveData.live_operator) return null;

    const operators = Array.isArray(liveData.live_operator)
      ? liveData.live_operator
      : [liveData.live_operator];

    for (const op of operators) {
      const opStartTime = parseInt(op.start_time || 0);
      const opEndTime = parseInt(op.end_time || Infinity);

      if (partStartTime >= opStartTime && partStartTime < opEndTime) {
        return op;
      }
    }

    return null;
  }

  findComponent(partStartTime, currentTime, liveData) {
    if (!liveData.live_component) return null;

    const components = Array.isArray(liveData.live_component)
      ? liveData.live_component
      : [liveData.live_component];

    for (const comp of components) {
      const compStartTime = parseInt(comp.start_time || 0);
      const compEndTime = parseInt(comp.end_time || Infinity);

      if (partStartTime >= compStartTime && partStartTime < compEndTime) {
        return comp;
      }
    }

    return null;
  }

  parseMachineStatus(machineStatusData) {
    if (!machineStatusData) return [];

    // Parse ThingsBoard timeseries format: [[ts1, val1], [ts2, val2], ...]
    if (Array.isArray(machineStatusData) && machineStatusData.length > 0) {
      if (Array.isArray(machineStatusData[0])) {
        return machineStatusData.map(entry => ({
          ts: parseInt(entry[0]),
          status: parseInt(entry[1])
        }));
      }
    }

    return [];
  }

  calculateTimings(startTime, endTime, machineStatus) {
    let runTime = 0, idleTime = 0, stopTime = 0, networkTime = 0;

    if (!machineStatus || machineStatus.length === 0) {
      return { run_time: runTime, idle_time: idleTime, stop_time: stopTime, network_f_time: networkTime };
    }

    // Find status entries within the time window
    const relevantStatus = machineStatus.filter(s => s.ts >= startTime && s.ts <= endTime);

    if (relevantStatus.length === 0) {
      // No status data in window, use status before startTime
      const lastBefore = machineStatus.filter(s => s.ts < startTime).pop();
      if (lastBefore) {
        const duration = (endTime - startTime) / 1000;
        const status = lastBefore.status;

        if (status === 3) runTime = duration;
        else if ([0, 1, 2].includes(status)) idleTime = duration;
        else if (status === 5) stopTime = duration;
        else if (status === 100) networkTime = duration;
      }
      return { run_time: runTime, idle_time: idleTime, stop_time: stopTime, network_f_time: networkTime };
    }

    // Calculate duration for each status
    for (let i = 0; i < relevantStatus.length; i++) {
      const currentStatus = relevantStatus[i];
      const nextTs = i + 1 < relevantStatus.length ? relevantStatus[i + 1].ts : endTime;
      const duration = (nextTs - currentStatus.ts) / 1000;

      const status = currentStatus.status;
      if (status === 3) runTime += duration;
      else if ([0, 1, 2].includes(status)) idleTime += duration;
      else if (status === 5) stopTime += duration;
      else if (status === 100) networkTime += duration;
    }

    return {
      run_time: Math.round(runTime),
      idle_time: Math.round(idleTime),
      stop_time: Math.round(stopTime),
      network_f_time: Math.round(networkTime)
    };
  }

  parseTouchTime(touchTimeStr) {
    // Convert "00:00:30" to seconds
    if (!touchTimeStr) return 0;
    const parts = touchTimeStr.split(':');
    return (parseInt(parts[0]) * 3600) + (parseInt(parts[1]) * 60) + parseInt(parts[2]);
  }
}

module.exports = SequenceProcessor;
