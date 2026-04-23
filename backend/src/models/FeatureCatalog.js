import pool from '../config/database.js';

export class FeatureCatalogModel {
  static async findAll() {
    const [rows] = await pool.execute(
      'SELECT feature_key, description FROM features ORDER BY feature_key ASC'
    );
    return rows;
  }

  static async exists(featureKey) {
    const [rows] = await pool.execute('SELECT 1 FROM features WHERE feature_key = ? LIMIT 1', [
      featureKey
    ]);
    return rows.length > 0;
  }

  static async create({ featureKey, description }) {
    await pool.execute('INSERT INTO features (feature_key, description) VALUES (?, ?)', [
      featureKey,
      description || null
    ]);
    const [rows] = await pool.execute('SELECT feature_key, description FROM features WHERE feature_key = ?', [
      featureKey
    ]);
    return rows[0];
  }
}
