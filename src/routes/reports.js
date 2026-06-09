const express = require('express');
const router = express.Router();
const ThingsboardReportService = require('../thingsboardReportService');

const reportService = new ThingsboardReportService();

// Get shift list
router.get('/shift-list/:customerName', async (req, res) => {
  try {
    const { customerName } = req.params;
    const shifts = await reportService.getShiftList(customerName);
    res.json({
      message: 'Gopal',
      data: shifts
    });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get machine list
router.get('/machine-list/:customerName', async (req, res) => {
  try {
    const { customerName } = req.params;
    const machines = await reportService.getMachineList(customerName);
    res.json({
      message: 'Gopal',
      data: machines
    });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// OLD: Sequence report endpoint (keeping for backward compatibility)
router.get('/sequence-report/:machine/:shiftNo/:fromTime/:toTime/:page/:limit', async (req, res) => {
  try {
    const { machine, shiftNo, fromTime, toTime, page, limit } = req.params;

    // Convert date format (YYYY-MM-DD) to timestamps if needed
    let fromTs = parseInt(fromTime);
    let toTs = parseInt(toTime);

    // If not a valid timestamp, try parsing as date string (YYYY-MM-DD)
    if (isNaN(fromTs) || fromTime.includes('-')) {
      fromTs = new Date(fromTime + 'T00:00:00Z').getTime();
    }
    if (isNaN(toTs) || toTime.includes('-')) {
      toTs = new Date(toTime + 'T23:59:59Z').getTime();
    }

    console.log(`[API] /sequence-report query:`, { machine: decodeURIComponent(machine), fromTime, toTime, fromTs, toTs, page, limit });

    // Use cached data from scheduled updater
    if (req.reportUpdater) {
      const report = req.reportUpdater.getPartReportByMachine(
        decodeURIComponent(machine),
        shiftNo,
        fromTs,
        toTs,
        parseInt(page) - 1,
        parseInt(limit)
      );
      console.log(`[API] Response:`, { dataCount: report.data.length, totalReports: report.totalReports });
      res.json(report);
    } else {
      res.status(500).json({ error: 'Updater not available' });
    }
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// NEW: Fresh API endpoint with query parameters (simpler and cleaner)
router.get('/reports', async (req, res) => {
  try {
    const { machine, startDate, endDate, page = 1, limit = 10 } = req.query;

    // Validate required params
    if (!machine || !startDate || !endDate) {
      return res.status(400).json({
        error: 'Missing required parameters: machine, startDate, endDate',
        example: '/api/v1/reports?machine=SURIN_PUNE-BFW01&startDate=2026-06-09&endDate=2026-06-09&page=1&limit=10'
      });
    }

    // Convert date format (YYYY-MM-DD) to timestamps
    const fromTs = new Date(startDate + 'T00:00:00Z').getTime();
    const toTs = new Date(endDate + 'T23:59:59Z').getTime();

    console.log(`[API] /reports query:`, { machine, startDate, endDate, fromTs, toTs, page, limit });

    // Use cached data from scheduled updater
    if (!req.reportUpdater) {
      return res.status(500).json({ error: 'Updater not available' });
    }

    const report = req.reportUpdater.getPartReportByMachine(
      machine,
      'all',
      fromTs,
      toTs,
      parseInt(page) - 1,
      parseInt(limit)
    );

    console.log(`[API] Response:`, { dataCount: report.data.length, totalReports: report.totalReports });

    res.json({
      success: true,
      machine,
      startDate,
      endDate,
      page: parseInt(page),
      limit: parseInt(limit),
      totalReports: report.totalReports,
      data: report.data
    });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
