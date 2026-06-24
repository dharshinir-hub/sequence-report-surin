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
router.get('/sequence-report/download/:machine/:shiftNo/:fromTime/:toTime', async (req, res) => {
  try {
    const { machine, shiftNo, fromTime, toTime } = req.params;

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

    // CSV columns mirror the on-screen Sequence Report table exactly. The 16
    // part-level columns (S.no .. Component Status) are written only on a part's
    // FIRST sequence row and left BLANK on its remaining sequence rows — the same
    // parent/child layout the table shows, so part values don't repeat down rows.
    const headers = [
      'S.no', 'Date & Time', 'Machine Name', 'Operator No', 'Operator Name',
      'Comp. Drawing No', 'Comp. Description', 'Comp. Serial No', 'Program No',
      'Revision No', 'Actual Part Count', 'Run Time', 'Idle Time', 'Disconnect Time',
      'Alarm Time', 'Component Status', 'Operation Sequence', 'Planned Touch Time',
      'Start Time', 'End Time', 'Actual Run Time', 'Operation Status', 'Alarm', 'Message'
    ];

    // seconds -> HH:MM:SS (matches the table's formatTime)
    const hms = (s) => {
      const n = Number(s);
      if (isNaN(n)) return '00:00:00';
      const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), sec = Math.round(n % 60);
      return [h, m, sec].map(v => String(v).padStart(2, '0')).join(':');
    };
    // epoch ms -> "DD-MM-YYYY HH:mm:ss" (matches the table's Date & Time column)
    const dateTime = (ms) => {
      const d = new Date(Number(ms));
      if (isNaN(d.getTime())) return '';
      const p = (v) => String(v).padStart(2, '0');
      return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    };
    // epoch ms -> "HH:MM:SS" time-of-day (matches the table's seq Start/End columns)
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

    const rows = [];
    rows.push(headers.map(cell).join(','));

    let sno = 0;
    report.data.forEach(part => {
      sno += 1;
      // 16 part-level columns
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

      // 8 detail columns shared by sequence and balloon rows. The first column
      // is the Operation Sequence label: "S<n>" for a sequence, "B<n>" for a
      // balloon (matching the on-screen table).
      const detailCols = (label, planned, start, end, run, status, alarm, message) => [
        label, fb(planned), timeOfDay(start), timeOfDay(end), num(run), fb(status), fb(alarm), fb(message)
      ];

      const details = Array.isArray(part.sequence_detail) ? part.sequence_detail : [];
      if (details.length === 0) {
        rows.push([...partBase, '', '', '', '', '', '', '', ''].map(cell).join(','));
      } else {
        let firstRow = true;
        details.forEach(seq => {
          // sequence row "S<n>": part-level cells only on the very first row
          const base = firstRow ? partBase : blankBase;
          firstRow = false;
          rows.push([...base, ...detailCols(
            'S' + seq.operation_sequence, seq.planed_touch_time, seq.start, seq.end,
            seq.actual_run, seq.operation_status, seq.alarm, seq.message
          )].map(cell).join(','));

          // nested balloon rows "B<n>": part-level cells always blank
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
