import pool from '../config/database.js';

const cols =
  'id, organization_id, created_by_user_id, h5p_content_id, title, library_name, main_library_version, content_json, metadata_json, created_at, updated_at';

function jsonForDb(value) {
  if (value == null) return JSON.stringify({});
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function idNumber(id) {
  const n = typeof id === 'bigint' ? Number(id) : Number(id);
  return Number.isFinite(n) ? n : null;
}

function normalizeRow(row) {
  if (!row) return null;
  const o = { ...row };
  for (const key of ['id', 'organization_id', 'created_by_user_id']) {
    if (typeof o[key] === 'bigint') o[key] = Number(o[key]);
  }
  for (const key of ['content_json', 'metadata_json']) {
    if (o[key] != null && typeof o[key] === 'string') {
      try {
        o[key] = JSON.parse(o[key]);
      } catch {
        o[key] = {};
      }
    }
  }
  return o;
}

export class H5pContentModel {
  static async findById(id) {
    const [rows] = await pool.execute(`SELECT ${cols} FROM h5p_contents WHERE id = ?`, [idNumber(id)]);
    return normalizeRow(rows[0]) || null;
  }

  static async findByH5pContentId(h5pContentId) {
    const [rows] = await pool.execute(`SELECT ${cols} FROM h5p_contents WHERE h5p_content_id = ?`, [
      String(h5pContentId)
    ]);
    return normalizeRow(rows[0]) || null;
  }

  static async listForOrganization(organizationId, { createdByUserId = null, limit = 200 } = {}) {
    const orgId = idNumber(organizationId);
    const values = [orgId];
    let sql = `SELECT ${cols} FROM h5p_contents WHERE organization_id = ?`;
    if (createdByUserId != null) {
      sql += ' AND created_by_user_id = ?';
      values.push(idNumber(createdByUserId));
    }
    sql += ' ORDER BY updated_at DESC LIMIT ?';
    values.push(Math.min(500, Math.max(1, Number(limit) || 200)));
    const [rows] = await pool.execute(sql, values);
    return rows.map(normalizeRow);
  }

  static async create({
    organizationId,
    createdByUserId,
    h5pContentId,
    title,
    libraryName,
    mainLibraryVersion = null,
    contentJson = {},
    metadataJson = {}
  }) {
    const [result] = await pool.execute(
      `INSERT INTO h5p_contents
        (organization_id, created_by_user_id, h5p_content_id, title, library_name, main_library_version, content_json, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        idNumber(organizationId),
        idNumber(createdByUserId),
        String(h5pContentId),
        String(title || 'Untitled').slice(0, 500),
        String(libraryName),
        mainLibraryVersion,
        jsonForDb(contentJson),
        jsonForDb(metadataJson)
      ]
    );
    return await this.findById(result.insertId);
  }

  static async update(id, fields) {
    const updates = [];
    const values = [];
    if (fields.title !== undefined) {
      updates.push('title = ?');
      values.push(String(fields.title).slice(0, 500));
    }
    if (fields.libraryName !== undefined) {
      updates.push('library_name = ?');
      values.push(fields.libraryName);
    }
    if (fields.mainLibraryVersion !== undefined) {
      updates.push('main_library_version = ?');
      values.push(fields.mainLibraryVersion);
    }
    if (fields.contentJson !== undefined) {
      updates.push('content_json = ?');
      values.push(jsonForDb(fields.contentJson));
    }
    if (fields.metadataJson !== undefined) {
      updates.push('metadata_json = ?');
      values.push(jsonForDb(fields.metadataJson));
    }
    if (fields.h5pContentId !== undefined) {
      updates.push('h5p_content_id = ?');
      values.push(String(fields.h5pContentId));
    }
    if (updates.length === 0) return await this.findById(id);
    values.push(idNumber(id));
    await pool.execute(
      `UPDATE h5p_contents SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      values
    );
    return await this.findById(id);
  }

  static async delete(id) {
    await pool.execute('DELETE FROM h5p_contents WHERE id = ?', [idNumber(id)]);
  }
}
