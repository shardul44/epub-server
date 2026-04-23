import pool from '../config/database.js';

const cols =
  'id, chapter_id, type, content_json, position, created_at, updated_at';

export class InteractiveBlockModel {
  static async findById(id) {
    const [rows] = await pool.execute(`SELECT ${cols} FROM interactive_blocks WHERE id = ?`, [id]);
    return rows[0] || null;
  }

  static async findByChapterId(chapterId) {
    const [rows] = await pool.execute(
      `SELECT ${cols} FROM interactive_blocks WHERE chapter_id = ? ORDER BY position ASC, id ASC`,
      [chapterId]
    );
    return rows;
  }

  static async create({ chapterId, type, contentJson, position = 0 }) {
    const [result] = await pool.execute(
      'INSERT INTO interactive_blocks (chapter_id, type, content_json, position) VALUES (?, ?, ?, ?)',
      [chapterId, type, contentJson, position]
    );
    return await this.findById(result.insertId);
  }

  static async update(id, { type, contentJson, position }) {
    const updates = [];
    const values = [];
    if (type !== undefined) {
      updates.push('type = ?');
      values.push(type);
    }
    if (contentJson !== undefined) {
      updates.push('content_json = ?');
      values.push(contentJson);
    }
    if (position !== undefined) {
      updates.push('position = ?');
      values.push(position);
    }
    if (updates.length === 0) return await this.findById(id);
    values.push(id);
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

