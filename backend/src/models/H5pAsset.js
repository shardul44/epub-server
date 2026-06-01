import pool from '../config/database.js';

const cols = 'id, h5p_content_id, asset_type, file_path, mime_type, file_size, metadata_json, created_at';

function jsonForDb(value) {
  if (value == null) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function idNumber(id) {
  const n = typeof id === 'bigint' ? Number(id) : Number(id);
  return Number.isFinite(n) ? n : null;
}

function normalizeRow(row) {
  if (!row) return null;
  const o = { ...row };
  if (typeof o.id === 'bigint') o.id = Number(o.id);
  if (typeof o.h5p_content_id === 'bigint') o.h5p_content_id = Number(o.h5p_content_id);
  if (typeof o.file_size === 'bigint') o.file_size = Number(o.file_size);
  if (o.metadata_json != null && typeof o.metadata_json === 'string') {
    try {
      o.metadata_json = JSON.parse(o.metadata_json);
    } catch {
      o.metadata_json = {};
    }
  }
  return o;
}

export class H5pAssetModel {
  static async findByContentId(h5pContentDbId) {
    const [rows] = await pool.execute(
      `SELECT ${cols} FROM h5p_assets WHERE h5p_content_id = ? ORDER BY id ASC`,
      [idNumber(h5pContentDbId)]
    );
    return rows.map(normalizeRow);
  }

  static async create({ h5pContentDbId, assetType = 'file', filePath, mimeType = null, fileSize = null, metadataJson = null }) {
    const [result] = await pool.execute(
      `INSERT INTO h5p_assets (h5p_content_id, asset_type, file_path, mime_type, file_size, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        idNumber(h5pContentDbId),
        String(assetType),
        String(filePath).slice(0, 1024),
        mimeType,
        fileSize != null ? idNumber(fileSize) : null,
        jsonForDb(metadataJson)
      ]
    );
    const [rows] = await pool.execute(`SELECT ${cols} FROM h5p_assets WHERE id = ?`, [result.insertId]);
    return normalizeRow(rows[0]);
  }

  static async deleteByContentId(h5pContentDbId) {
    await pool.execute('DELETE FROM h5p_assets WHERE h5p_content_id = ?', [idNumber(h5pContentDbId)]);
  }
}
