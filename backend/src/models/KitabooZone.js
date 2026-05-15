import pool from '../config/database.js';
import { pdfDocumentWhereClause } from '../utils/tenantScope.js';

/** Build zone row for response (shared by getZonesByPdfId and getZonesByJobId). */
function rowToZone(row) {
  const zone = {
    id: row.zone_id,
    type: row.type,
    x: row.x,
    y: row.y,
    w: row.width,
    h: row.height,
    readingOrder: row.reading_order,
    content: row.content,
    enrichmentType: row.enrichment_type,
    enrichmentValue: row.enrichment_value,
    fontSize: row.font_size,
    fontFamily: row.font_family,
    color: row.color,
    bold: !!row.is_bold,
    italic: !!row.is_italic,
    origin: row.origin ? JSON.parse(String(row.origin)) : null,
    ascender: row.ascender ?? 0.8,
    descender: row.descender ?? -0.2,
    fontFile: row.font_file || null,
    strokeColor: row.stroke_color || null,
    strokeWidth: row.stroke_width || null,
    textShadow: row.text_shadow || null,
    letterSpacing: row.letter_spacing || null,
    lines: (() => {
    if (row.lines == null) return undefined;
    try {
      return typeof row.lines === 'string' ? JSON.parse(row.lines) : row.lines;
    } catch {
      return undefined;
    }
  })(),
    points: (() => {
    if (row.points == null) return undefined;
    try {
      return typeof row.points === 'string' ? JSON.parse(row.points) : row.points;
    } catch {
      return undefined;
    }
  })(),
    styleRuns: (() => {
    if (row.style_runs == null) return undefined;
    try {
      return typeof row.style_runs === 'string' ? JSON.parse(row.style_runs) : row.style_runs;
    } catch {
      return undefined;
    }
  })()
  };
  const meta = KitabooZoneModel._inferLineFragmentMeta(row.zone_id);
  if (meta) {
    zone.isLineFragment = true;
    zone.baseZoneId = meta.baseZoneId;
    zone.lineIndex = meta.lineIndex;
  }
  return zone;
}

let _hasStyleRunsColumn = null;

export class KitabooZoneModel {
  static async _hasStyleRunsColumn(connection) {
    if (_hasStyleRunsColumn !== null) return _hasStyleRunsColumn;
    const [rows] = await connection.execute('DESCRIBE kitaboo_zones');
    _hasStyleRunsColumn = rows.some(r => r.Field === 'style_runs');
    return _hasStyleRunsColumn;
  }

  /** Save zones for a job (job-scoped). Use this for studio when URL is by jobId. */
  static async saveZonesForJob(jobId, pdfId, pageNumber, zones) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        'DELETE FROM kitaboo_zones WHERE job_id = ? AND page_number = ?',
        [String(jobId), pageNumber]
      );
      if (zones.length > 0) {
        const hasStyleRuns = await KitabooZoneModel._hasStyleRunsColumn(connection);
        const values = zones.map((z, index) => {
          const row = [
            String(jobId),
            pdfId,
            pageNumber,
            z.id,
            z.type,
            z.x,
            z.y,
            z.w,
            z.h,
            z.readingOrder || index + 1,
            z.content || null,
            z.enrichmentType || null,
            z.enrichmentValue || null,
            z.fontSize || null,
            z.fontFamily || null,
            z.color || null,
            z.bold ? 1 : 0,
            z.italic ? 1 : 0,
            z.origin ? JSON.stringify(z.origin) : null,
            z.ascender ?? 0.8,
            z.descender ?? -0.2,
            z.fontFile || null,
            z.strokeColor || null,
            z.strokeWidth || null,
            z.textShadow || null,
            z.letterSpacing || null,
            Array.isArray(z.lines) && z.lines.length > 0 ? JSON.stringify(z.lines) : null,
            Array.isArray(z.points) && z.points.length >= 3 ? JSON.stringify(z.points) : null
          ];
          if (hasStyleRuns) {
            row.push(Array.isArray(z.styleRuns) && z.styleRuns.length > 0 ? JSON.stringify(z.styleRuns) : null);
          }
          return row;
        });
        const styleRunsCol = hasStyleRuns ? ', style_runs' : '';
        await connection.query(
          `INSERT INTO kitaboo_zones 
          (job_id, pdf_document_id, page_number, zone_id, type, x, y, width, height, reading_order, content, enrichment_type, enrichment_value, font_size, font_family, color, is_bold, is_italic, origin, ascender, descender, font_file, stroke_color, stroke_width, text_shadow, letter_spacing, \`lines\`, \`points\`${styleRunsCol}) 
          VALUES ?`,
          [values]
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async saveZones(pdfId, pageNumber, zones) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        'DELETE FROM kitaboo_zones WHERE pdf_document_id = ? AND page_number = ? AND (job_id IS NULL OR job_id = "")',
        [pdfId, pageNumber]
      );
      if (zones.length > 0) {
        const values = zones.map((z, index) => [
          pdfId,
          pageNumber,
          z.id,
          z.type,
          z.x,
          z.y,
          z.w,
          z.h,
          z.readingOrder || index + 1,
          z.content || null,
          z.enrichmentType || null,
          z.enrichmentValue || null
        ]);
        await connection.query(
          `INSERT INTO kitaboo_zones 
          (pdf_document_id, page_number, zone_id, type, x, y, width, height, reading_order, content, enrichment_type, enrichment_value) 
          VALUES ?`,
          [values]
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Infer line-fragment metadata from zone id (for multi-line shrink-wrapped highlighting).
   * Persisted zones don't store isLineFragment/baseZoneId/lineIndex; we derive from id pattern.
   */
  static _inferLineFragmentMeta(zoneId) {
    if (!zoneId || typeof zoneId !== 'string') return null;
    // Sentence-level: p1_z1_s0_frag0 -> baseZoneId p1_z1_s0, lineIndex 0
    const sentFrag = zoneId.match(/^(.+_s\d+)_frag(\d+)$/);
    if (sentFrag) {
      return { isLineFragment: true, baseZoneId: sentFrag[1], lineIndex: parseInt(sentFrag[2], 10) };
    }
    // Word-level: p1_z1_frag0 -> baseZoneId p1_z1, lineIndex 0
    const wordFrag = zoneId.match(/^(.+)_frag(\d+)$/);
    if (wordFrag) {
      return { isLineFragment: true, baseZoneId: wordFrag[1], lineIndex: parseInt(wordFrag[2], 10) };
    }
    return null;
  }

  static async getZonesByJobId(jobId) {
    const [rows] = await pool.execute(
      'SELECT * FROM kitaboo_zones WHERE job_id = ? ORDER BY page_number, reading_order',
      [String(jobId)]
    );
    const grouped = {};
    rows.forEach(row => {
      if (!grouped[row.page_number]) grouped[row.page_number] = [];
      grouped[row.page_number].push(rowToZone(row));
    });
    return grouped;
  }

  static async getZonesByPdfId(pdfId) {
    const [rows] = await pool.execute(
      'SELECT * FROM kitaboo_zones WHERE pdf_document_id = ? AND (job_id IS NULL OR job_id = "") ORDER BY page_number, reading_order',
      [pdfId]
    );
    const grouped = {};
    rows.forEach(row => {
      if (!grouped[row.page_number]) grouped[row.page_number] = [];
      grouped[row.page_number].push(rowToZone(row));
    });
    return grouped;
  }

  /** List distinct FXL jobs that have zones in DB (for recovering jobs after server restart). */
  static async getDistinctJobs(user = null, options = {}) {
    try {
      let sql = `SELECT DISTINCT kz.job_id, kz.pdf_document_id
         FROM kitaboo_zones kz`;
      const params = [];
      if (user) {
        const w = pdfDocumentWhereClause(user, options);
        sql += ` INNER JOIN pdf_documents p ON p.id = kz.pdf_document_id WHERE kz.job_id IS NOT NULL AND kz.job_id != '' AND (${w.sql})`;
        params.push(...w.params);
      } else {
        sql += ` WHERE kz.job_id IS NOT NULL AND kz.job_id != ''`;
      }
      sql += ' ORDER BY kz.job_id';
      const [rows] = await pool.execute(sql, params);
      return rows.map(r => ({ jobId: String(r.job_id), pdfId: r.pdf_document_id }));
    } catch (err) {
      // Table may not exist yet — return empty list instead of crashing
      if (err.code === 'ER_NO_SUCH_TABLE' || err.message?.includes("doesn't exist")) {
        return [];
      }
      throw err;
    }
  }

  /** Get one FXL job by jobId from DB (for recovering when opening studio). Returns { jobId, pdfId } or null. */
  static async getJobByJobId(jobId) {
    try {
      const [rows] = await pool.execute(
        'SELECT job_id, pdf_document_id FROM kitaboo_zones WHERE job_id = ? LIMIT 1',
        [String(jobId)]
      );
      if (rows.length === 0) return null;
      return { jobId: String(rows[0].job_id), pdfId: rows[0].pdf_document_id };
    } catch (err) {
      if (err.code === 'ER_NO_SUCH_TABLE' || err.message?.includes("doesn't exist")) {
        return null;
      }
      throw err;
    }
  }

  /** Delete all zones for an FXL job (used when deleting the job). */
  static async deleteByJobId(jobId) {
    const [result] = await pool.execute('DELETE FROM kitaboo_zones WHERE job_id = ?', [String(jobId)]);
    return result.affectedRows ?? 0;
  }
}

