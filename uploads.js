const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const path     = require('path');
const { v4: uuidv4 } = require('uuid');
const supabase = require('./db');
const { requireAuth } = require('./auth');
const emailService = require('./email');

// ── Multer config — memory storage, validate file type ────────
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'image/svg+xml'];
const ALLOWED_3D_TYPES = ['application/octet-stream', 'model/stl', 'model/obj', 'text/plain'];
const MAX_SIZE_MB   = 20;

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_SIZE_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_TYPES.includes(file.mimetype) || ['.stl','.obj'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed. Accepted: JPG, PNG, WebP, PDF, SVG, STL, OBJ`));
    }
  },
});

// ── POST /api/uploads/custom-request ─────────────────────────
// Accepts up to 3 reference images + form data
// Form fields: name, email, material, size, description
// Form files:  images (up to 3)
router.post('/custom-request', upload.array('images', 3), async (req, res) => {
  try {
    const { name, email, material, size, description } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'At least one reference image is required' });
    }

    // Upload each image to Supabase Storage
    const imageUrls = [];
    for (const file of req.files) {
      const ext      = path.extname(file.originalname) || '.jpg';
      const filename = `${uuidv4()}${ext}`;
      const storagePath = `custom-requests/${filename}`;

      const { error: uploadError } = await supabase.storage
        .from(process.env.STORAGE_BUCKET_UPLOADS || 'custom-uploads')
        .upload(storagePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from(process.env.STORAGE_BUCKET_UPLOADS || 'custom-uploads')
        .getPublicUrl(storagePath);

      imageUrls.push(publicUrl);
    }

    // Generate custom request ID
    const { data: lastReq } = await supabase
      .from('custom_requests')
      .select('id')
      .order('created_at', { ascending: false })
      .limit(1);
    const lastNum = lastReq && lastReq[0] ? parseInt(lastReq[0].id.replace('CR-', ''), 10) : 12;
    const requestId = `CR-${String(lastNum + 1).padStart(4, '0')}`;

    // Calculate estimate
    const matMult   = { PLA: 1, PETG: 1.2, Resin: 1.85, TPU: 1.35 };
    const sizeMult  = { Small: 8, Medium: 14, Large: 22 };
    const estimate  = (sizeMult[size] || 14) * (matMult[material] || 1);

    // Save to database
    await supabase.from('custom_requests').insert({
      id:            requestId,
      customer_name: name,
      customer_email: email,
      description,
      material:      material || 'PLA',
      size:          size || 'Medium',
      estimate:      Math.round(estimate * 100) / 100,
      image_urls:    imageUrls,
      status:        'new',
    });

    // Email admin about new request
    await emailService.sendAdminCustomRequest({
      id:          requestId,
      name,
      email,
      description,
      material,
      size,
      estimate,
      imageUrls,
    });

    // Acknowledgement email to customer
    await emailService.sendCustomRequestAcknowledgement({ name, email, requestId, estimate });

    res.json({
      success:   true,
      requestId,
      imageUrls,
      estimate:  Math.round(estimate * 100) / 100,
      message:   "Request received — we'll send a quote within 24 hours.",
    });

  } catch (err) {
    console.error('[UPLOADS] custom-request error:', err);
    res.status(500).json({ error: err.message || 'Upload failed. Please try again.' });
  }
});

// ── POST /api/uploads/print-file ──────────────────────────────
// Admin: upload a G-code or STL file for a catalogue item or order
// Requires auth
router.post('/print-file', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const { orderId, catalogueId } = req.body;
    const ext      = path.extname(req.file.originalname);
    const filename = `${uuidv4()}${ext}`;
    const storagePath = `print-files/${filename}`;

    const { error: uploadError } = await supabase.storage
      .from(process.env.STORAGE_BUCKET_PRINTFILES || 'print-files')
      .upload(storagePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false,
      });

    if (uploadError) throw uploadError;

    // Link to order or catalogue item
    if (orderId) {
      await supabase
        .from('orders')
        .update({ print_file: filename, print_status: 'ready', updated_at: new Date().toISOString() })
        .eq('id', orderId);
    }
    if (catalogueId) {
      await supabase
        .from('catalogue')
        .update({ print_file_path: storagePath })
        .eq('id', catalogueId);
    }

    res.json({ success: true, filename, storagePath });

  } catch (err) {
    console.error('[UPLOADS] print-file error:', err);
    res.status(500).json({ error: 'File upload failed' });
  }
});

// ── GET /api/uploads/custom-requests ─────────────────────────
// Admin: list all custom requests
router.get('/custom-requests', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('custom_requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ requests: data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

// ── PATCH /api/uploads/custom-requests/:id ───────────────────
// Admin: update status or note on a custom request
router.patch('/custom-requests/:id', requireAuth, async (req, res) => {
  try {
    const { status, internal_note } = req.body;
    const updates = { updated_at: new Date().toISOString() };
    if (status)        updates.status = status;
    if (internal_note) updates.internal_note = internal_note;

    const { data, error } = await supabase
      .from('custom_requests')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update request' });
  }
});

// ── POST /api/uploads/catalogue-stl ──────────────────────────
// Admin: upload an STL file for a catalogue item
// Returns a public URL stored in Supabase Storage
router.post('/catalogue-stl', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const ext      = path.extname(req.file.originalname).toLowerCase() || '.stl';
    const filename = `catalogue-stl/${uuidv4()}${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(process.env.STORAGE_BUCKET_PRINTFILES || 'print-files')
      .upload(filename, req.file.buffer, {
        contentType: 'application/octet-stream',
        upsert: false,
      });

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from(process.env.STORAGE_BUCKET_PRINTFILES || 'print-files')
      .getPublicUrl(filename);

    // If a catalogue item name was provided, update it in the database
    const { catalogueItemName } = req.body;
    if (catalogueItemName) {
      await supabase
        .from('catalogue')
        .update({ stl_url: publicUrl })
        .eq('name', catalogueItemName);
    }

    res.json({ success: true, url: publicUrl, filename });

  } catch (err) {
    console.error('[UPLOADS] catalogue-stl error:', err);
    res.status(500).json({ error: 'STL upload failed: ' + err.message });
  }
});

module.exports = router;
