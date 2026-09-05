const express = require('express');
const { sql, getPool } = require('../db');

const router = express.Router();

// GET /api/users
router.get('/', async (req, res) => {
  const pool = await getPool();
  const result = await pool.request().query('SELECT id, name, email, role FROM Users ORDER BY name ASC');
  res.json(result.recordset);
});

// PATCH /api/users/:id
// Body: { role: 'captain'|'member' }
router.patch('/:id', async (req, res) => {
  const { role } = req.body;
  if (!['captain', 'member'].includes(role)) {
    return res.status(400).json({ error: 'role must be captain or member' });
  }
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.NVarChar, req.params.id)
    .input('role', sql.NVarChar, role)
    .query('UPDATE Users SET role = @role WHERE id = @id');
  res.json({ id: req.params.id, role });
});

module.exports = router;
