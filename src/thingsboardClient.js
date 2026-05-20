const axios = require('axios');

class ThingsboardClient {
  constructor() {
    this.baseUrl = process.env.THINGSBOARD_REST_URL;
    this.user = process.env.THINGSBOARD_USER;
    this.password = process.env.THINGSBOARD_PASSWORD;
    this.token = null;
  }

  async authenticate() {
    if (this.token) return this.token;

    try {
      const response = await axios.post(`${this.baseUrl}/api/auth/login`, {
        username: this.user,
        password: this.password
      });
      this.token = response.data.token;
      return this.token;
    } catch (error) {
      console.error('Authentication failed:', error.message);
      throw error;
    }
  }

  async getDeviceTelemetry(deviceId, keys) {
    try {
      await this.authenticate();
      const keyParam = keys.join(',');
      const response = await axios.get(
        `${this.baseUrl}/api/plugins/telemetry/DEVICE/${deviceId}/values/timeseries?keys=${keyParam}`,
        {
          headers: { 'X-Authorization': `Bearer ${this.token}` }
        }
      );
      return response.data;
    } catch (error) {
      console.error('Failed to fetch telemetry:', error.message);
      return {};
    }
  }

  async postSequenceReport(deviceId, partRecord) {
    try {
      await this.authenticate();

      // Format telemetry for ThingsBoard
      const telemetry = [
        {
          ts: parseInt(partRecord.start_time), // Use part's start_time as timestamp
          values: {
            sequence_report: partRecord
          }
        }
      ];

      const response = await axios.post(
        `${this.baseUrl}/api/plugins/telemetry/DEVICE/${deviceId}/timeseries/LONG`,
        telemetry,
        {
          headers: { 'X-Authorization': `Bearer ${this.token}` }
        }
      );

      console.log(`✓ Posted sequence_report for part ${partRecord.actual_part} with ts=${partRecord.start_time}`);
      return response.data;
    } catch (error) {
      console.error('Failed to post sequence report:', error.message);
      throw error;
    }
  }
}

module.exports = ThingsboardClient;
