const express  = require('express');
const router   = express.Router();
const supabase = require('./db');
const { requireAuth } = require('./auth');

// ── GET /api/catalogue ────────────────────────────────────────
// Public: list all active catalogue items
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('catalogue')
      .select('*')
      .eq('active', true)
      .order('id');
    if (error) throw error;
    res.json({ items: data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch catalogue' });
  }
});

// ── POST /api/catalogue ───────────────────────────────────────
// Admin: add new catalogue item
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, category, description, base_price, materials, colours, shape, tag, photo_url, stl_url } = req.body;
    if (!name || !base_price) return res.status(400).json({ error: 'Name and price required' });

    const { data, error } = await supabase
      .from('catalogue')
      .insert({ name, category, description, base_price, materials, colours, shape, tag, photo_url, stl_url, active: true })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create item' });
  }
});

// ── PATCH /api/catalogue/:id ──────────────────────────────────
// Admin: update a catalogue item
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('catalogue')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update item' });
  }
});

// ── DELETE /api/catalogue/:id ─────────────────────────────────
// Admin: soft-delete (sets active = false)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await supabase
      .from('catalogue')
      .update({ active: false })
      .eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove item' });
  }
});

module.exports = router;
