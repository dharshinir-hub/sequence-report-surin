const axios = require('axios');

class ThingsboardReportService {
  constructor() {
    this.baseUrl = process.env.THINGSBOARD_REST_URL;
    this.user = process.env.THINGSBOARD_USER;
    this.password = process.env.THINGSBOARD_PASSWORD;
    this.token = null;
    this.tokenExpiry = 0; // epoch ms when the current token expires
  }

  // Decode a JWT's "exp" claim (seconds) into epoch ms; falls back to +1h
  getTokenExpiry(token) {
    try {
      const payload = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64').toString('utf8')
      );
      if (payload && payload.exp) return payload.exp * 1000;
    } catch (e) {
      // ignore decode errors, use fallback below
    }
    return Date.now() + 60 * 60 * 1000;
  }

  // Returns a valid token, re-logging in when expired/near expiry (or forced).
  // This prevents the "works until the token expires, then needs a restart" bug.
  async authenticate(force = false) {
    const now = Date.now();
    // Reuse the cached token only while it's still valid (60s safety buffer)
    if (!force && this.token && now < this.tokenExpiry - 60000) {
      return this.token;
    }

    try {
      const response = await axios.post(`${this.baseUrl}/api/auth/login`, {
        username: this.user,
        password: this.password
      });
      this.token = response.data.token;
      this.tokenExpiry = this.getTokenExpiry(this.token);
      return this.token;
    } catch (error) {
      console.error('Authentication failed:', error.message);
      this.token = null;
      this.tokenExpiry = 0;
      throw error;
    }
  }

  // If a request failed with 401 Unauthorized, drop the cached token so the
  // next call logs in again (handles ThingsBoard restarts / revoked tokens).
  clearTokenOnAuthError(error) {
    if (error && error.response && error.response.status === 401) {
      this.token = null;
      this.tokenExpiry = 0;
    }
  }

  // Get all devices for a customer
  async getDevicesByCustomer(customerId) {
    try {
      await this.authenticate();

      // If no customer ID provided, get from env
      if (!customerId) {
        customerId = process.env.CUSTOMER_ID;
      }

      if (!customerId) {
        console.warn('No customer ID provided');
        return [];
      }

      // Get devices for this customer
      const response = await axios.get(
        `${this.baseUrl}/api/customer/${customerId}/devices?pageSize=1000&page=0`,
        { headers: { 'X-Authorization': `Bearer ${this.token}` } }
      );
      return response.data.data || [];
    } catch (error) {
      console.error('Failed to fetch devices for customer:', error.message);
      this.clearTokenOnAuthError(error);
      return [];
    }
  }

  // Get device telemetry for a specific time range
  async getDeviceTelemetry(deviceId, keys, startTime, endTime) {
    try {
      await this.authenticate();
      const keyParam = keys.join(',');
      // Fetch with a large limit to ensure all telemetry in the time range is returned
      // (e.g., all serial_number, program_number, revision_no changes during the part window)
      const response = await axios.get(
        `${this.baseUrl}/api/plugins/telemetry/DEVICE/${deviceId}/values/timeseries?keys=${keyParam}&startTs=${startTime}&endTs=${endTime}&limit=10000`,
        { headers: { 'X-Authorization': `Bearer ${this.token}` } }
      );
      return response.data;
    } catch (error) {
      console.error('Failed to fetch telemetry:', error.message);
      this.clearTokenOnAuthError(error);
      return {};
    }
  }

  // Get latest telemetry
  async getLatestTelemetry(deviceId, keys) {
    try {
      await this.authenticate();
      const keyParam = keys.join(',');
      const response = await axios.get(
        `${this.baseUrl}/api/plugins/telemetry/DEVICE/${deviceId}/values/timeseries?keys=${keyParam}&limit=1`,
        { headers: { 'X-Authorization': `Bearer ${this.token}` } }
      );
      return response.data;
    } catch (error) {
      console.error('Failed to fetch latest telemetry:', error.message);
      this.clearTokenOnAuthError(error);
      return {};
    }
  }

  // Post telemetry data to device (individual part with single timestamp)
  async postDeviceTelemetry(deviceId, telemetryKey, data, timestamp = null) {
    try {
      await this.authenticate();

      const ts = timestamp || Date.now();
      const payload = {
        ts,
        values: {
          [telemetryKey]: typeof data === 'string' ? data : JSON.stringify(data)
        }
      };

      await axios.post(
        `${this.baseUrl}/api/plugins/telemetry/DEVICE/${deviceId}/timeseries/values`,
        payload,
        { headers: { 'X-Authorization': `Bearer ${this.token}` } }
      );

      return true;
    } catch (error) {
      console.error(`Error posting ${telemetryKey} to ThingsBoard:`, error.response?.status, error.message);
      this.clearTokenOnAuthError(error);
      return false;
    }
  }

  // Parse machine status timeseries
  parseMachineStatus(statusData) {
    if (!statusData || !Array.isArray(statusData)) return [];
    return statusData.map(entry => ({
      ts: parseInt(entry[0]),
      status: parseInt(entry[1])
    }));
  }

  // Calculate timings from machine status
  calculateTimings(startTime, endTime, machineStatus) {
    let runTime = 0, idleTime = 0, stopTime = 0, networkTime = 0;

    if (!machineStatus || machineStatus.length === 0) {
      return { run_time: 0, idle_time: 0, stop_time: 0, network_f_time: 0 };
    }

    const relevantStatus = machineStatus.filter(s => s.ts >= startTime && s.ts <= endTime);

    for (let i = 0; i < relevantStatus.length; i++) {
      const current = relevantStatus[i];
      const nextTs = i + 1 < relevantStatus.length ? relevantStatus[i + 1].ts : endTime;
      const duration = (nextTs - current.ts) / 1000; // Convert to seconds

      if (current.status === 3) runTime += duration;
      else if ([0, 1, 2].includes(current.status)) idleTime += duration;
      else if (current.status === 5) stopTime += duration;
      else if (current.status === 100) networkTime += duration;
    }

    return {
      run_time: Math.round(runTime),
      idle_time: Math.round(idleTime),
      stop_time: Math.round(stopTime),
      network_f_time: Math.round(networkTime)
    };
  }

  // Convert seconds to HH:MM:SS
  secondsToHMS(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  // Get general report - directly from ThingsBoard (no waiting for MQTT)
  async getGeneralReport(machine, shiftNo, fromTime, toTime, page = 0, limit = 10) {
    try {
      // Get all devices
      const devices = await this.getDevicesByCustomer(null);
      const device = devices.find(d => d.name === machine || d.label === machine);

      if (!device) {
        return { message: 'Gopal', data: [], page: page + 1, pagecount: limit, totalReports: 0 };
      }

      // Fetch sequence report telemetry from ThingsBoard for this time range
      const telemetry = await this.getDeviceTelemetry(
        device.id.id,
        ['sequence_report'],
        fromTime,
        toTime
      );

      const sequenceReports = telemetry.sequence_report || [];
      const reportData = [];

      // Parse each sequence report and aggregate by date/shift
      sequenceReports.forEach(entry => {
        try {
          const ts = entry[0];
          const reportObj = typeof entry[1] === 'string' ? JSON.parse(entry[1]) : entry[1];

          const date = new Date(ts).toISOString().split('T')[0];

          reportData.push({
            date,
            machine: reportObj.machine_name || machine,
            shift: reportObj.shift_no || shiftNo,
            operator_id: reportObj.operator_no || '-',
            operator_name: reportObj.operator_name || 'No operator',
            component_number: reportObj.component_no || '-',
            component_name: reportObj.component_name || 'No component',
            target: 1,
            actual: reportObj.actual_part || 0,
            palet_num: '1',
            palet_detail: [],
            reject: 0,
            rework: 0,
            efficiency: 0,
            utilisation: ((reportObj.run_time || 0) * 100 / ((reportObj.run_time || 0) + (reportObj.idle_time || 0) + (reportObj.stop_time || 0))).toFixed(2),
            run_time: this.secondsToHMS(reportObj.run_time || 0),
            idle_time: this.secondsToHMS(reportObj.idle_time || 0),
            disconnect_time: this.secondsToHMS(reportObj.network_f_time || 0),
            duration: this.secondsToHMS((reportObj.run_time || 0) + (reportObj.idle_time || 0) + (reportObj.stop_time || 0))
          });
        } catch (e) {
          console.error('Error parsing report entry:', e.message);
        }
      });

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
      console.error('Error fetching general report:', error.message);
      return { message: 'Gopal', data: [], Page: page + 1, pagecount: limit, totalReports: 0 };
    }
  }

  // Get part report - directly from ThingsBoard
  async getPartReport(machine, shiftNo, fromTime, toTime, page = 0, limit = 10) {
    try {
      const devices = await this.getDevicesByCustomer(null);
      const device = devices.find(d => d.name === machine || d.label === machine);

      if (!device) {
        return { message: 'Gopal', data: [], page: page + 1, pagecount: limit, totalReports: 0 };
      }

      const telemetry = await this.getDeviceTelemetry(
        device.id.id,
        ['sequence_report'],
        fromTime,
        toTime
      );

      const sequenceReports = telemetry.sequence_report || [];
      const reportData = [];

      sequenceReports.forEach(entry => {
        try {
          const reportObj = typeof entry[1] === 'string' ? JSON.parse(entry[1]) : entry[1];

          // Add each sequence detail as a separate row
          if (reportObj.sequence_detail && Array.isArray(reportObj.sequence_detail)) {
            reportObj.sequence_detail.forEach(seq => {
              reportData.push({
                date: new Date(reportObj.start_time).toISOString().split('T')[0],
                machine: reportObj.machine_name || machine,
                shift: reportObj.shift_no || shiftNo,
                part_number: reportObj.actual_part,
                sequence: seq.value,
                operator_no: reportObj.operator_no || '-',
                operator_name: reportObj.operator_name || 'No operator',
                component_number: reportObj.component_no || '-',
                component_name: reportObj.component_name || 'No component',
                serial_no: reportObj.serial_number || reportObj.serial_no || '-',
                program_no: reportObj.program_number || '-',
                revision_no: reportObj.revision_no || reportObj.revision_number || '-',
                planned_touch_time: seq.planed_run_time || 0,
                actual_run: this.secondsToHMS(seq.actual_run || 0),
                actual_idle: this.secondsToHMS(seq.actual_idle || 0),
                actual_stop: this.secondsToHMS(seq.actual_stop || 0),
                operation_status: seq.operation_status || '-',
                alarm: seq.alarm || '-',
                message: seq.message || '-'
              });
            });
          }
        } catch (e) {
          console.error('Error parsing part report entry:', e.message);
        }
      });

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
      console.error('Error fetching part report:', error.message);
      return { message: 'Gopal', data: [], Page: page + 1, pagecount: limit, totalReports: 0 };
    }
  }

  // Get OEE report
  async getOeeReport(machine, shiftNo, fromTime, toTime, page = 0, limit = 10) {
    try {
      const generalReport = await this.getGeneralReport(machine, shiftNo, fromTime, toTime, page, limit);

      const oeeData = generalReport.data.map(report => ({
        ...report,
        availability: 85,
        performance: 90,
        quality: 95,
        oee: (85 * 90 * 95) / 10000
      }));

      return {
        message: 'Gopal',
        data: oeeData,
        page: generalReport.page,
        pagecount: generalReport.pagecount,
        totalReports: generalReport.totalReports
      };
    } catch (error) {
      console.error('Error fetching OEE report:', error.message);
      return { data: [], total: 0, page, limit };
    }
  }

  // Get shift list
  async getShiftList(customerName) {
    try {
      // Return predefined shifts
      return [
        { shift_no: 1, shift_name: 'Shift 1', start_time: '06:00', end_time: '14:00' },
        { shift_no: 2, shift_name: 'Shift 2', start_time: '14:00', end_time: '22:00' },
        { shift_no: 3, shift_name: 'Shift 3', start_time: '22:00', end_time: '06:00' }
      ];
    } catch (error) {
      console.error('Error fetching shifts:', error.message);
      return [];
    }
  }

  // Get machine list
  async getMachineList(customerName) {
    try {
      const devices = await this.getDevicesByCustomer(customerName);
      return devices.map(device => ({
        machine_id: device.id.id,
        machine_name: device.name,
        machine_label: device.label,
        status: 'Active'
      }));
    } catch (error) {
      console.error('Error fetching machine list:', error.message);
      return [];
    }
  }

  // Get customer attributes (shift schedule, etc)
  async getCustomerAttributes(customerId) {
    try {
      await this.authenticate();

      if (!customerId) {
        customerId = process.env.CUSTOMER_ID;
      }

      if (!customerId) {
        console.warn('No customer ID provided');
        return {};
      }

      // GET /api/plugins/telemetry/CUSTOMER/{customerId}/values/attributes?keys=allShift
      const response = await axios.get(
        `${this.baseUrl}/api/plugins/telemetry/CUSTOMER/${customerId}/values/attributes?keys=allShift`,
        { headers: { 'X-Authorization': `Bearer ${this.token}` } }
      );

      // Parse response array into object with key-value pairs
      const attributes = {};
      if (Array.isArray(response.data)) {
        response.data.forEach(attr => {
          attributes[attr.key] = attr.value;
        });
      }

      return attributes;
    } catch (error) {
      console.error('Failed to fetch customer attributes:', error.message);
      this.clearTokenOnAuthError(error);
      return {};
    }
  }
}

module.exports = ThingsboardReportService;
