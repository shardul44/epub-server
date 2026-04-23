import express from 'express';
import { authenticate, requireFeature } from '../middlewares/auth.js';
import { ROLES } from '../constants/roles.js';
import {
  successResponse,
  errorResponse,
  badRequestResponse,
  notFoundResponse,
  forbiddenResponse
} from '../utils/responseHandler.js';
import { InteractiveBookModel } from '../models/InteractiveBook.js';
import { InteractiveChapterModel } from '../models/InteractiveChapter.js';
import { InteractiveBlockModel } from '../models/InteractiveBlock.js';
import pool from '../config/database.js';
import { InteractiveEpubExportService } from '../services/interactiveEpubExportService.js';

const router = express.Router();
router.use(authenticate, requireFeature('interactive.content'));

function canAccessOrgScopedRow(req, organizationId) {
  if (req.user?.role === ROLES.PLATFORM_ADMIN) return false;
  const myOrgId = req.user?.organizationId ?? null;
  return myOrgId != null && Number(myOrgId) === Number(organizationId);
}

async function getBookOr404(req, res, bookId) {
  const book = await InteractiveBookModel.findById(bookId);
  if (!book) {
    notFoundResponse(res, 'Book not found');
    return null;
  }
  if (!canAccessOrgScopedRow(req, book.organization_id)) {
    forbiddenResponse(res, 'Forbidden');
    return null;
  }
  return book;
}

async function getChapterWithBookOr404(req, res, chapterId) {
  const [rows] = await pool.execute(
    `SELECT c.id AS chapter_id, c.book_id, c.title AS chapter_title, c.position AS chapter_position, c.metadata_json AS chapter_metadata_json,
            b.id AS book_id, b.organization_id, b.title AS book_title
     FROM interactive_chapters c
     JOIN interactive_books b ON b.id = c.book_id
     WHERE c.id = ?`,
    [chapterId]
  );
  const row = rows[0] || null;
  if (!row) {
    notFoundResponse(res, 'Chapter not found');
    return null;
  }
  if (!canAccessOrgScopedRow(req, row.organization_id)) {
    forbiddenResponse(res, 'Forbidden');
    return null;
  }
  return row;
}

async function getBlockWithChapterBookOr404(req, res, blockId) {
  const [rows] = await pool.execute(
    `SELECT bl.id AS block_id, bl.chapter_id, bl.type, bl.content_json, bl.position AS block_position,
            c.book_id,
            b.organization_id
     FROM interactive_blocks bl
     JOIN interactive_chapters c ON c.id = bl.chapter_id
     JOIN interactive_books b ON b.id = c.book_id
     WHERE bl.id = ?`,
    [blockId]
  );
  const row = rows[0] || null;
  if (!row) {
    notFoundResponse(res, 'Block not found');
    return null;
  }
  if (!canAccessOrgScopedRow(req, row.organization_id)) {
    forbiddenResponse(res, 'Forbidden');
    return null;
  }
  return row;
}

// -----------------------------------------------------------------------------
// Books
// -----------------------------------------------------------------------------
router.get('/books', async (req, res) => {
  try {
    const rows =
      req.user?.role === ROLES.PLATFORM_ADMIN
        ? await InteractiveBookModel.findAll()
        : await InteractiveBookModel.findByOrganizationId(req.user.organizationId);
    return successResponse(res, rows);
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.post('/books', async (req, res) => {
  try {
    const { title, description = null, metadataJson = null, organizationId } = req.body || {};
    if (!title || !String(title).trim()) return badRequestResponse(res, 'title is required');

    let orgId = req.user?.organizationId ?? null;
    if (req.user?.role === ROLES.PLATFORM_ADMIN && organizationId !== undefined) {
      orgId = organizationId === null || organizationId === '' ? null : Number(organizationId);
    }
    if (req.user?.role !== ROLES.PLATFORM_ADMIN && orgId == null) {
      return badRequestResponse(res, 'Your user must belong to an organization to create books');
    }

    const book = await InteractiveBookModel.create({
      organizationId: orgId,
      createdByUserId: req.user?.id ?? null,
      title: String(title).trim(),
      description: description == null ? null : String(description),
      metadataJson: metadataJson ?? null
    });
    return successResponse(res, book, 201);
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.get('/books/:bookId', async (req, res) => {
  try {
    const bookId = parseInt(req.params.bookId, 10);
    if (Number.isNaN(bookId)) return badRequestResponse(res, 'Invalid bookId');
    const book = await getBookOr404(req, res, bookId);
    if (!book) return;
    return successResponse(res, book);
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.put('/books/:bookId', async (req, res) => {
  try {
    const bookId = parseInt(req.params.bookId, 10);
    if (Number.isNaN(bookId)) return badRequestResponse(res, 'Invalid bookId');
    const book = await getBookOr404(req, res, bookId);
    if (!book) return;

    const { title, description, metadataJson } = req.body || {};
    if (title !== undefined && !String(title).trim()) {
      return badRequestResponse(res, 'title cannot be empty');
    }
    const updated = await InteractiveBookModel.update(bookId, {
      title: title !== undefined ? String(title).trim() : undefined,
      description: description !== undefined ? (description == null ? null : String(description)) : undefined,
      metadataJson: metadataJson !== undefined ? (metadataJson ?? null) : undefined
    });
    return successResponse(res, updated);
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.delete('/books/:bookId', async (req, res) => {
  try {
    const bookId = parseInt(req.params.bookId, 10);
    if (Number.isNaN(bookId)) return badRequestResponse(res, 'Invalid bookId');
    const book = await getBookOr404(req, res, bookId);
    if (!book) return;
    await InteractiveBookModel.delete(bookId);
    return res.status(204).send();
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

// -----------------------------------------------------------------------------
// Chapters
// -----------------------------------------------------------------------------
router.get('/books/:bookId/chapters', async (req, res) => {
  try {
    const bookId = parseInt(req.params.bookId, 10);
    if (Number.isNaN(bookId)) return badRequestResponse(res, 'Invalid bookId');
    const book = await getBookOr404(req, res, bookId);
    if (!book) return;
    const chapters = await InteractiveChapterModel.findByBookId(bookId);
    return successResponse(res, chapters);
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.post('/books/:bookId/chapters', async (req, res) => {
  try {
    const bookId = parseInt(req.params.bookId, 10);
    if (Number.isNaN(bookId)) return badRequestResponse(res, 'Invalid bookId');
    const book = await getBookOr404(req, res, bookId);
    if (!book) return;

    const { title, position = 0, metadataJson = null } = req.body || {};
    if (!title || !String(title).trim()) return badRequestResponse(res, 'title is required');

    const chapter = await InteractiveChapterModel.create({
      bookId,
      title: String(title).trim(),
      position: Number(position) || 0,
      metadataJson: metadataJson ?? null
    });
    return successResponse(res, chapter, 201);
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.get('/chapters/:chapterId', async (req, res) => {
  try {
    const chapterId = parseInt(req.params.chapterId, 10);
    if (Number.isNaN(chapterId)) return badRequestResponse(res, 'Invalid chapterId');
    const row = await getChapterWithBookOr404(req, res, chapterId);
    if (!row) return;
    const chapter = await InteractiveChapterModel.findById(chapterId);
    return successResponse(res, chapter);
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.put('/chapters/:chapterId', async (req, res) => {
  try {
    const chapterId = parseInt(req.params.chapterId, 10);
    if (Number.isNaN(chapterId)) return badRequestResponse(res, 'Invalid chapterId');
    const row = await getChapterWithBookOr404(req, res, chapterId);
    if (!row) return;

    const { title, position, metadataJson } = req.body || {};
    if (title !== undefined && !String(title).trim()) {
      return badRequestResponse(res, 'title cannot be empty');
    }
    const updated = await InteractiveChapterModel.update(chapterId, {
      title: title !== undefined ? String(title).trim() : undefined,
      position: position !== undefined ? (Number(position) || 0) : undefined,
      metadataJson: metadataJson !== undefined ? (metadataJson ?? null) : undefined
    });
    return successResponse(res, updated);
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.delete('/chapters/:chapterId', async (req, res) => {
  try {
    const chapterId = parseInt(req.params.chapterId, 10);
    if (Number.isNaN(chapterId)) return badRequestResponse(res, 'Invalid chapterId');
    const row = await getChapterWithBookOr404(req, res, chapterId);
    if (!row) return;
    await InteractiveChapterModel.delete(chapterId);
    return res.status(204).send();
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.post('/books/:bookId/chapters/reorder', async (req, res) => {
  try {
    const bookId = parseInt(req.params.bookId, 10);
    if (Number.isNaN(bookId)) return badRequestResponse(res, 'Invalid bookId');
    const book = await getBookOr404(req, res, bookId);
    if (!book) return;

    const { chapterIds } = req.body || {};
    if (!Array.isArray(chapterIds) || chapterIds.length === 0) {
      return badRequestResponse(res, 'chapterIds must be a non-empty array');
    }
    const normalized = chapterIds.map((id) => Number(id));
    if (normalized.some((id) => !Number.isInteger(id) || id < 1)) {
      return badRequestResponse(res, 'chapterIds contains invalid ids');
    }

    const existing = await InteractiveChapterModel.findByBookId(bookId);
    const existingIds = existing.map((c) => Number(c.id));
    if (existingIds.length !== normalized.length) {
      return badRequestResponse(res, 'chapterIds length does not match existing chapters');
    }
    const existingSet = new Set(existingIds);
    if (normalized.some((id) => !existingSet.has(id))) {
      return badRequestResponse(res, 'chapterIds contains ids that do not belong to this book');
    }

    for (let i = 0; i < normalized.length; i++) {
      await InteractiveChapterModel.update(normalized[i], { position: i });
    }
    const updated = await InteractiveChapterModel.findByBookId(bookId);
    return successResponse(res, updated);
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

// -----------------------------------------------------------------------------
// Blocks
// -----------------------------------------------------------------------------
router.get('/chapters/:chapterId/blocks', async (req, res) => {
  try {
    const chapterId = parseInt(req.params.chapterId, 10);
    if (Number.isNaN(chapterId)) return badRequestResponse(res, 'Invalid chapterId');
    const row = await getChapterWithBookOr404(req, res, chapterId);
    if (!row) return;
    const blocks = await InteractiveBlockModel.findByChapterId(chapterId);
    return successResponse(res, blocks);
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.post('/chapters/:chapterId/blocks', async (req, res) => {
  try {
    const chapterId = parseInt(req.params.chapterId, 10);
    if (Number.isNaN(chapterId)) return badRequestResponse(res, 'Invalid chapterId');
    const row = await getChapterWithBookOr404(req, res, chapterId);
    if (!row) return;

    const { type, contentJson, position = 0 } = req.body || {};
    if (!type || !String(type).trim()) return badRequestResponse(res, 'type is required');
    if (contentJson == null || typeof contentJson !== 'object') {
      return badRequestResponse(res, 'contentJson must be an object');
    }

    const block = await InteractiveBlockModel.create({
      chapterId,
      type: String(type).trim(),
      contentJson: contentJson,
      position: Number(position) || 0
    });
    return successResponse(res, block, 201);
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.get('/blocks/:blockId', async (req, res) => {
  try {
    const blockId = parseInt(req.params.blockId, 10);
    if (Number.isNaN(blockId)) return badRequestResponse(res, 'Invalid blockId');
    const row = await getBlockWithChapterBookOr404(req, res, blockId);
    if (!row) return;
    const block = await InteractiveBlockModel.findById(blockId);
    return successResponse(res, block);
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.put('/blocks/:blockId', async (req, res) => {
  try {
    const blockId = parseInt(req.params.blockId, 10);
    if (Number.isNaN(blockId)) return badRequestResponse(res, 'Invalid blockId');
    const row = await getBlockWithChapterBookOr404(req, res, blockId);
    if (!row) return;

    const { type, contentJson, position } = req.body || {};
    if (type !== undefined && !String(type).trim()) return badRequestResponse(res, 'type cannot be empty');
    if (contentJson !== undefined && (contentJson == null || typeof contentJson !== 'object')) {
      return badRequestResponse(res, 'contentJson must be an object');
    }

    const updated = await InteractiveBlockModel.update(blockId, {
      type: type !== undefined ? String(type).trim() : undefined,
      contentJson: contentJson !== undefined ? contentJson : undefined,
      position: position !== undefined ? (Number(position) || 0) : undefined
    });
    return successResponse(res, updated);
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.delete('/blocks/:blockId', async (req, res) => {
  try {
    const blockId = parseInt(req.params.blockId, 10);
    if (Number.isNaN(blockId)) return badRequestResponse(res, 'Invalid blockId');
    const row = await getBlockWithChapterBookOr404(req, res, blockId);
    if (!row) return;
    await InteractiveBlockModel.delete(blockId);
    return res.status(204).send();
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.post('/chapters/:chapterId/blocks/reorder', async (req, res) => {
  try {
    const chapterId = parseInt(req.params.chapterId, 10);
    if (Number.isNaN(chapterId)) return badRequestResponse(res, 'Invalid chapterId');
    const chapter = await getChapterWithBookOr404(req, res, chapterId);
    if (!chapter) return;

    const { blockIds } = req.body || {};
    if (!Array.isArray(blockIds) || blockIds.length === 0) {
      return badRequestResponse(res, 'blockIds must be a non-empty array');
    }
    const normalized = blockIds.map((id) => Number(id));
    if (normalized.some((id) => !Number.isInteger(id) || id < 1)) {
      return badRequestResponse(res, 'blockIds contains invalid ids');
    }

    const existing = await InteractiveBlockModel.findByChapterId(chapterId);
    const existingIds = existing.map((b) => Number(b.id));
    if (existingIds.length !== normalized.length) {
      return badRequestResponse(res, 'blockIds length does not match existing blocks');
    }
    const existingSet = new Set(existingIds);
    if (normalized.some((id) => !existingSet.has(id))) {
      return badRequestResponse(res, 'blockIds contains ids that do not belong to this chapter');
    }

    for (let i = 0; i < normalized.length; i++) {
      await InteractiveBlockModel.update(normalized[i], { position: i });
    }
    const updated = await InteractiveBlockModel.findByChapterId(chapterId);
    return successResponse(res, updated);
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

// -----------------------------------------------------------------------------
// Export
// -----------------------------------------------------------------------------
router.post('/books/:bookId/export/epub', async (req, res) => {
  try {
    const bookId = parseInt(req.params.bookId, 10);
    if (Number.isNaN(bookId)) return badRequestResponse(res, 'Invalid bookId');
    const book = await getBookOr404(req, res, bookId);
    if (!book) return;

    const includeInteractiveJs = req.body?.interactiveEpub !== false;
    const chapters = await InteractiveChapterModel.findByBookId(bookId);
    const blocksByChapterId = new Map();
    for (const ch of chapters) {
      const blocks = await InteractiveBlockModel.findByChapterId(ch.id);
      blocksByChapterId.set(Number(ch.id), blocks);
    }

    const buf = await InteractiveEpubExportService.buildEpubBuffer({
      book,
      chapters,
      blocksByChapterId,
      includeInteractiveJs
    });

    const safeBase = String(book.title || `book_${bookId}`)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '_')
      .slice(0, 80) || `book_${bookId}`;
    const fileName = `interactive_${bookId}_${safeBase}.epub`;

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Type', 'application/epub+zip');
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('Cache-Control', 'no-cache');
    return res.end(buf, 'binary');
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

export default router;

