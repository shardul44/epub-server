import pool from '../config/database.js';

const cols =
  'id, book_id, title, position, metadata_json, created_at, updated_at';

export class InteractiveChapterModel {
  static async findById(id) {
    const [rows] = await pool.execute(`SELECT ${cols} FROM interactive_chapters WHERE id = ?`, [id]);
    return rows[0] || null;
  }

  static async findByBookId(bookId) {
    const [rows] = await pool.execute(
      `SELECT ${cols} FROM interactive_chapters WHERE book_id = ? ORDER BY position ASC, id ASC`,
      [bookId]
    );
    return rows;
  }

  static async create({ bookId, title, position = 0, metadataJson = null }) {
    const [result] = await pool.execute(
      'INSERT INTO interactive_chapters (book_id, title, position, metadata_json) VALUES (?, ?, ?, ?)',
      [bookId, title, position, metadataJson]
    );
    return await this.findById(result.insertId);
  }

  static async update(id, { title, position, metadataJson }) {
    const updates = [];
    const values = [];
    if (title !== undefined) {
      updates.push('title = ?');
      values.push(title);
    }
    if (position !== undefined) {
      updates.push('position = ?');
      values.push(position);
    }
    if (metadataJson !== undefined) {
      updates.push('metadata_json = ?');
      values.push(metadataJson);
    }
    if (updates.length === 0) return await this.findById(id);
    values.push(id);
    await pool.execute(
      `UPDATE interactive_chapters SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      values
    );
    return await this.findById(id);
  }

  static async delete(id) {
    await pool.execute('DELETE FROM interactive_chapters WHERE id = ?', [id]);
  }
}

