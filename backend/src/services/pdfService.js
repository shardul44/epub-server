import { PdfDocumentModel } from '../models/PdfDocument.js';
import fs from 'fs/promises';
import path from 'path';
import pdfParse from 'pdf-parse';
import { getUploadDir, ensureDirectories } from '../config/fileStorage.js';
import { v4 as uuidv4 } from 'uuid';
import { LicenseService } from './licenseService.js';

export class PdfService {
  static async getAllPdfs(user, options = {}) {
    const pdfs = user
      ? await PdfDocumentModel.findAllForUser(user, options)
      : await PdfDocumentModel.findAll();
    return pdfs.map((pdf) => this.convertToDTO(pdf));
  }

  static async getPdfDocument(id) {
    const pdf = await PdfDocumentModel.findById(id);
    if (!pdf) {
      throw new Error('PDF document not found with id: ' + id);
    }
    return this.convertToDTO(pdf);
  }

  static async countPdfPagesFromBuffer(buffer) {
    try {
      const data = await pdfParse(buffer);
      const n = Number(data?.numpages);
      if (Number.isFinite(n) && n >= 1) return Math.min(Math.floor(n), 500000);
    } catch {
      /* fall through */
    }
    return 1;
  }

  static async uploadAndAnalyzePdf(file, options = {}, owner = null) {
    await ensureDirectories();

    const { audioFile = null, layoutType = 'REFLOWABLE' } = options;

    const uploadDir = getUploadDir();
    const fileName = uuidv4() + path.extname(file.originalname);
    const filePath = path.join(uploadDir, fileName);

    const totalPages = await this.countPdfPagesFromBuffer(file.buffer);

    const orgId = owner?.organizationId ?? null;
    let consumed = 0;
    if (orgId) {
      await LicenseService.assertAndConsumePdfPages(orgId, totalPages);
      consumed = totalPages;
    }

    try {
      await fs.writeFile(filePath, file.buffer);
      const stats = await fs.stat(filePath);
      const documentType = 'OTHER';
      const pageQuality = 'DIGITAL_NATIVE';
      const languages = ['en'];

      let audioFilePath = null;
      let audioFileName = null;

      if (audioFile) {
        const audioFileName = uuidv4() + path.extname(audioFile.originalname);
        const audioPath = path.join(uploadDir, audioFileName);
        await fs.writeFile(audioPath, audioFile.buffer);
        audioFilePath = audioPath;
        audioFileName = audioFile.originalname;
      }

      const pdfData = {
        fileName,
        originalFileName: file.originalname,
        filePath,
        fileSize: stats.size,
        totalPages,
        documentType,
        pageQuality,
        languages,
        hasTables: false,
        hasFormulas: false,
        hasMultiColumn: false,
        scannedPagesCount: 0,
        digitalPagesCount: totalPages,
        layoutType,
        audioFilePath,
        audioFileName,
        audioSynced: false,
        userId: owner?.userId ?? null,
        organizationId: owner?.organizationId ?? null
      };

      const pdf = await PdfDocumentModel.create(pdfData);
      return this.convertToDTO(pdf);
    } catch (e) {
      if (consumed && orgId) {
        await LicenseService.refundPdfPages(orgId, consumed).catch(() => {});
      }
      throw e;
    }
  }

  static async extractAndUploadPdfsFromZip(zipFile) {
    // TODO: Implement ZIP extraction using jszip
    // This would extract PDFs from ZIP and process each one
    // For now, return empty array
    return [];
  }

  static async deletePdfDocument(id) {
    console.log('Starting deletion of PDF document with id:', id);
    
    try {
      const pdf = await PdfDocumentModel.findById(id);
      if (!pdf) {
        console.error('PDF document not found with id:', id);
        throw new Error('PDF document not found with id: ' + id);
      }

      console.log('Found PDF document:', {
        id: pdf.id,
        fileName: pdf.file_name,
        filePath: pdf.file_path,
        audioFilePath: pdf.audio_file_path
      });

      // Delete file from filesystem (don't fail if file doesn't exist)
      if (pdf.file_path) {
        try {
          await fs.unlink(pdf.file_path);
          console.log('✓ Deleted PDF file:', pdf.file_path);
        } catch (fileError) {
          // File might not exist, that's okay - continue with deletion
          if (fileError.code !== 'ENOENT') {
            console.warn('⚠ Error deleting PDF file (continuing anyway):', pdf.file_path, fileError.message);
          } else {
            console.log('PDF file already deleted or does not exist:', pdf.file_path);
          }
        }
      }

      if (pdf.audio_file_path) {
        try {
          await fs.unlink(pdf.audio_file_path);
          console.log('✓ Deleted audio file:', pdf.audio_file_path);
        } catch (fileError) {
          // File might not exist, that's okay - continue with deletion
          if (fileError.code !== 'ENOENT') {
            console.warn('⚠ Error deleting audio file (continuing anyway):', pdf.audio_file_path, fileError.message);
          } else {
            console.log('Audio file already deleted or does not exist:', pdf.audio_file_path);
          }
        }
      }

      // Delete from database (manually handling CASCADE to ensure it works)
      console.log('Attempting database deletion...');
      try {
        await PdfDocumentModel.delete(id);
        console.log('✓ Successfully deleted PDF document from database:', id);
      } catch (dbError) {
        console.error('Database deletion error details:', {
          message: dbError.message,
          code: dbError.code,
          errno: dbError.errno,
          sqlState: dbError.sqlState,
          sqlMessage: dbError.sqlMessage
        });
        
        // Provide more specific error messages
        if (dbError.code === 'ER_ROW_IS_REFERENCED_2') {
          throw new Error('Cannot delete PDF: It is still referenced by other records. Please delete related conversions first.');
        } else if (dbError.code === 'ER_NO_REFERENCED_ROW_2') {
          throw new Error('Referential integrity error. Please try again.');
        } else {
          throw new Error('Database error: ' + (dbError.sqlMessage || dbError.message));
        }
      }
      
    } catch (error) {
      console.error('✗ Error in deletePdfDocument:', {
        message: error.message,
        code: error.code,
        stack: error.stack,
        id: id
      });
      throw error;
    }
  }

  static async getPdfsGroupedByZip(user, options = {}) {
    const grouped = {};
    const pdfs = user
      ? await PdfDocumentModel.findAllForUser(user, options)
      : await PdfDocumentModel.findAll();
    
    pdfs.forEach(pdf => {
      const groupId = pdf.zip_file_group_id || 'ungrouped';
      if (!grouped[groupId]) {
        grouped[groupId] = [];
      }
      grouped[groupId].push(this.convertToDTO(pdf));
    });

    return grouped;
  }

  static async downloadPdf(id) {
    const pdf = await PdfDocumentModel.findById(id);
    if (!pdf) {
      throw new Error('PDF document not found with id: ' + id);
    }

    const filePath = pdf.file_path;
    const exists = await fs.access(filePath).then(() => true).catch(() => false);
    
    if (!exists) {
      throw new Error('PDF file not found on server');
    }

    return {
      filePath,
      originalFileName: pdf.original_file_name
    };
  }

  static async downloadAudio(id) {
    const pdf = await PdfDocumentModel.findById(id);
    if (!pdf || !pdf.audio_file_path) {
      throw new Error('Audio file not found');
    }

    const exists = await fs.access(pdf.audio_file_path).then(() => true).catch(() => false);
    if (!exists) {
      throw new Error('Audio file not found on server');
    }

    return {
      filePath: pdf.audio_file_path,
      fileName: pdf.audio_file_name || 'audio.mp3'
    };
  }

  static convertToDTO(pdf) {
    return {
      id: pdf.id,
      fileName: pdf.file_name,
      originalFileName: pdf.original_file_name,
      fileSize: pdf.file_size,
      totalPages: pdf.total_pages,
      documentType: pdf.document_type,
      languages: pdf.languages || [],
      pageQuality: pdf.page_quality,
      hasTables: pdf.has_tables,
      hasFormulas: pdf.has_formulas,
      hasMultiColumn: pdf.has_multi_column,
      scannedPagesCount: pdf.scanned_pages_count,
      digitalPagesCount: pdf.digital_pages_count,
      layoutType: pdf.layout_type,
      zipFileName: pdf.zip_file_name,
      zipFileGroupId: pdf.zip_file_group_id,
      audioFilePath: pdf.audio_file_path,
      audioFileName: pdf.audio_file_name,
      audioSynced: pdf.audio_synced,
      createdAt: pdf.created_at
    };
  }
}

