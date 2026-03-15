const express        = require('express');
const router         = express.Router();
const { requireAuth } = require('./auth');
const printerService = require('./printer_service');

// ── GET /api/printer/status ───────────────────────────────────
router.get('/status', requireAuth, async (req, res) => {
  try {
    const status = await printerService.getPrinterStatus();
    res.json(status);
  } catch (err) {
    res.status(503).json({ error: 'Printer unreachable', detail: err.message });
  }
});

// ── POST /api/printer/test ────────────────────────────────────
router.post('/test', requireAuth, async (req, res) => {
  try {
    const version = await printerService.testConnection();
    res.json({ connected: true, version });
  } catch (err) {
    res.status(503).json({ connected: false, error: err.message });
  }
});

// ── POST /api/printer/control ─────────────────────────────────
// Body: { action: 'pause' | 'resume' | 'cancel' }
router.post('/control', requireAuth, async (req, res) => {
  try {
    const { action } = req.body;
    if (action === 'pause')  await printerService.pausePrint();
    else if (action === 'resume') await printerService.resumePrint();
    else if (action === 'cancel') await printerService.cancelPrint();
    else return res.status(400).json({ error: 'Invalid action' });
    res.json({ success: true, action });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
