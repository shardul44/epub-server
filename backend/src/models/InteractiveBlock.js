import pool from '../config/database.js';

const cols =
  'id, chapter_id, type, content_json, h5p_content_id, layout_json, position, created_at, updated_at';

/** JSON column + mysql2: bind JSON text to avoid mysqld_stmt_execute / ER_WRONG_ARGUMENTS. */
function contentJsonForDb(value) {
  if (value == null || typeof value !== 'object') {
    return JSON.stringify({});
  }
  return JSON.stringify(value);
}

function intOrZero(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.trunc(x));
}

function idNumber(id) {
  const n = typeof id === 'bigint' ? Number(id) : Number(id);
  return Number.isFinite(n) ? n : null;
}

/** Plain JSON-serializable row for API responses (BigInt-safe, parse content_json strings). */
function normalizeBlockRow(row) {
  if (!row) return null;
  const o = { ...row };
  if (typeof o.id === 'bigint') o.id = Number(o.id);
  if (typeof o.chapter_id === 'bigint') o.chapter_id = Number(o.chapter_id);
  if (typeof o.h5p_content_id === 'bigint') o.h5p_content_id = Number(o.h5p_content_id);
  const lj = o.layout_json;
  if (lj != null && typeof lj === 'string') {
    try {
      o.layout_json = JSON.parse(lj);
    } catch {
      o.layout_json = null;
    }
  }
  const cj = o.content_json;
  if (cj != null && typeof cj === 'string') {
    try {
      o.content_json = JSON.parse(cj);
    } catch {
      o.content_json = { html: '<p>(invalid block data)</p>', _invalidJson: true };
    }
  }
  return o;
}

export class InteractiveBlockModel {
  static async findById(id) {
    const [rows] = await pool.execute(`SELECT ${cols} FROM interactive_blocks WHERE id = ?`, [id]);
    return normalizeBlockRow(rows[0]) || null;
  }

  static async findByChapterId(chapterId) {
    const [rows] = await pool.execute(
      `SELECT ${cols} FROM interactive_blocks WHERE chapter_id = ? ORDER BY position ASC, id ASC`,
      [chapterId]
    );
    return rows.map((r) => normalizeBlockRow(r));
  }

  static async create({ chapterId, type, contentJson, position = 0, h5pContentId = null, layoutJson = null }) {
    const chId = idNumber(chapterId);
    if (chId == null || chId < 1) {
      throw new Error('Invalid chapterId');
    }
    const jsonStr = contentJsonForDb(contentJson);
    const pos = intOrZero(position);
    const layoutStr = layoutJson != null ? contentJsonForDb(layoutJson) : null;
    const h5pId = h5pContentId != null ? idNumber(h5pContentId) : null;
    const [result] = await pool.execute(
      'INSERT INTO interactive_blocks (chapter_id, type, content_json, h5p_content_id, layout_json, position) VALUES (?, ?, ?, ?, ?, ?)',
      [chId, String(type), jsonStr, h5pId, layoutStr, pos]
    );
    const rawId = result.insertId;
    const insertId = rawId != null ? idNumber(rawId) : null;
    return await this.findById(insertId);
  }

  static async update(id, { type, contentJson, position, h5pContentId, layoutJson }) {
    const updates = [];
    const values = [];
    if (type !== undefined) {
      updates.push('type = ?');
      values.push(type);
    }
    if (contentJson !== undefined) {
      updates.push('content_json = ?');
      values.push(contentJsonForDb(contentJson));
    }
    if (h5pContentId !== undefined) {
      updates.push('h5p_content_id = ?');
      values.push(h5pContentId != null ? idNumber(h5pContentId) : null);
    }
    if (layoutJson !== undefined) {
      updates.push('layout_json = ?');
      values.push(layoutJson != null ? contentJsonForDb(layoutJson) : null);
    }
    if (position !== undefined) {
      updates.push('position = ?');
      values.push(intOrZero(position));
    }
    if (updates.length === 0) return await this.findById(id);
    values.push(idNumber(id));
    await pool.execute(
      `UPDATE interactive_blocks SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      values
    );
    return await this.findById(id);
  }

  static async delete(id) {
    await pool.execute('DELETE FROM interactive_blocks WHERE id = ?', [id]);
  }
}

