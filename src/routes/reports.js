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

// CSV export endpoint (must come BEFORE the generic sequence-report route)
// :page uses (\d*) so it also matches an EMPTY segment — the frontend sends the
// page as blank, producing a double slash: /download/{machine}//{from}/{to}
router.get('/sequence-report/download/:machine/:page(\\d*)/:fromTime/:toTime', async (req, res) => {
  try {
    const { machine, fromTime, toTime } = req.params;
    const shiftNo = 'all'; // Default to all shifts for CSV export

    // Convert date format (YYYY-MM-DD) to timestamps if needed
    let fromTs = parseInt(fromTime);
    let toTs = parseInt(toTime);

    if (isNaN(fromTs) || fromTime.includes('-')) {
      fromTs = new Date(fromTime + 'T00:00:00Z').getTime();
    }
    if (isNaN(toTs) || toTime.includes('-')) {
      toTs = new Date(toTime + 'T23:59:59Z').getTime();
    }

    if (!req.reportUpdater) {
      return res.status(500).json({ error: 'Updater not available' });
    }

    // Get all data (high limit to fetch everything)
    const report = req.reportUpdater.getPartReportByMachine(
      decodeURIComponent(machine),
      shiftNo,
      fromTs,
      toTs,
      0, // page 0
      10000 // high limit to get all records
    );

    // Build CSV header
    const headers = [
      'Part Number',
      'Component No',
      'Component Name',
      'Operator No',
      'Operator Name',
      'Serial Number',
      'Program Number',
      'Revision No',
      'Start Time',
      'End Time',
      'Run Time (s)',
      'Idle Time (s)',
      'Disconnect Time (s)',
      'Alarm Time (s)',
      'Operation Sequence',
      'Operation Status',
      'Duration (s)',
      'Planned Touch Time (ms)',
      'Actual Run (s)',
      'Actual Idle (s)',
      'Message',
      'Alarm'
    ];

    const rows = [];
    rows.push(headers.map(h => `"${h}"`).join(','));

    // Build CSV rows: one row per sequence detail (to flatten the nested structure)
    report.data.forEach(part => {
      const partBase = [
        part.part_number,
        part.component_no,
        part.component_name,
        part.operator_no,
        part.operator_name,
        part.serial_number,
        part.program_number,
        part.revision_no,
        new Date(part.start_time).toISOString(),
        new Date(part.end_time).toISOString(),
        part.run_time,
        part.idle_time,
        part.disconnect_time,
        part.alarm_time
      ];

      if (!part.sequence_detail || part.sequence_detail.length === 0) {
        // No sequence details, just add the part info
        const row = [...partBase, '', '', '', '', '', '', '', ''];
        rows.push(row.map(cell => `"${cell}"`).join(','));
      } else {
        // Add one row per sequence detail
        part.sequence_detail.forEach(seq => {
          const seqData = [
            seq.operation_sequence,
            seq.operation_status,
            seq.duration,
            seq.planed_touch_time,
            seq.actual_run,
            seq.actual_idle,
            seq.message,
            seq.alarm
          ];
          const row = [...partBase, ...seqData];
          rows.push(row.map(cell => `"${cell}"`).join(','));
        });
      }
    });

    const csv = rows.join('\n');
    const filename = `sequence-report-${decodeURIComponent(machine)}-${fromTime}-${toTime}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
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
