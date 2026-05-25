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
import { canAccessInteractiveBook } from '../utils/tenantScope.js';
import { ActivityService } from '../services/activityService.js';

const router = express.Router();
router.use(authenticate, requireFeature('interactive.content'));

// Truncate a string for use inside an activity summary.
function trunc(s, n = 80) {
  if (s == null) return '';
  const str = String(s);
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

// Fire-and-forget activity log. Never blocks or breaks the route on failure.
// The ActivityService uses req.user.organizationId, so a member's edit is
// automatically visible to that org's admin via /activities listForViewer.
function logActivity(req, payload) {
  ActivityService.logFromRequest(req, payload).catch(() => {});
}

async function getBookOr404(req, res, bookId) {
  const book = await InteractiveBookModel.findById(bookId);
  if (!book) {
    notFoundResponse(res, 'Book not found');
    return null;
  }
  if (!canAccessInteractiveBook(req.user, book)) {
    forbiddenResponse(res, 'Forbidden');
    return null;
  }
  return book;
}

async function getChapterWithBookOr404(req, res, chapterId) {
  const [rows] = await pool.execute(
    `SELECT c.id AS chapter_id, c.book_id, c.title AS chapter_title, c.position AS chapter_position, c.metadata_json AS chapter_metadata_json,
            b.id AS book_id, b.organization_id, b.created_by_user_id, b.title AS book_title
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
  if (!canAccessInteractiveBook(req.user, { organization_id: row.organization_id, created_by_user_id: row.created_by_user_id })) {
    forbiddenResponse(res, 'Forbidden');
    return null;
  }
  return row;
}

async function getBlockWithChapterBookOr404(req, res, blockId) {
  const [rows] = await pool.execute(
    `SELECT bl.id AS block_id, bl.chapter_id, bl.type, bl.content_json, bl.position AS block_position,
            c.book_id,
            b.organization_id, b.created_by_user_id
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
  if (!canAccessInteractiveBook(req.user, { organization_id: row.organization_id, created_by_user_id: row.created_by_user_id })) {
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
        : await InteractiveBookModel.findForViewer(req.user);
    return successResponse(res, rows);
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

router.post('/books', async (req, res) => {
  try {
    // Any authenticated user with the `interactive.content` feature may create
    // a book. Members are scoped to their own rows by `canAccessInteractiveBook`
    // for all subsequent reads/writes (see tenantScope.js).
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
    logActivity(req, {
      action: 'interactive.book.create',
      entityType: 'interactive_book',
      entityId: book?.id ?? null,
      summary: `Created interactive book "${trunc(book?.title || title)}"`,
      metadata: { bookId: book?.id ?? null }
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
    const changed = [];
    if (title !== undefined) changed.push('title');
    if (description !== undefined) changed.push('description');
    if (metadataJson !== undefined) changed.push('metadata');
    logActivity(req, {
      action: 'interactive.book.update',
      entityType: 'interactive_book',
      entityId: bookId,
      summary: `Updated interactive book "${trunc(updated?.title || book.title)}"`,
      metadata: { bookId, changed }
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
    logActivity(req, {
      action: 'interactive.book.delete',
      entityType: 'interactive_book',
      entityId: bookId,
      summary: `Deleted interactive book "${trunc(book.title)}"`,
      metadata: { bookId }
    });
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
    logActivity(req, {
      action: 'interactive.chapter.create',
      entityType: 'interactive_chapter',
      entityId: chapter?.id ?? null,
      summary: `Added chapter "${trunc(chapter?.title || title)}" to "${trunc(book.title)}"`,
      metadata: { bookId, chapterId: chapter?.id ?? null }
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
    const changed = [];
    if (title !== undefined) changed.push('title');
    if (position !== undefined) changed.push('position');
    if (metadataJson !== undefined) changed.push('metadata');
    logActivity(req, {
      action: 'interactive.chapter.update',
      entityType: 'interactive_chapter',
      entityId: chapterId,
      summary: `Updated chapter "${trunc(updated?.title || row.chapter_title)}" in "${trunc(row.book_title)}"`,
      metadata: { bookId: row.book_id, chapterId, changed }
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
    logActivity(req, {
      action: 'interactive.chapter.delete',
      entityType: 'interactive_chapter',
      entityId: chapterId,
      summary: `Deleted chapter "${trunc(row.chapter_title)}" from "${trunc(row.book_title)}"`,
      metadata: { bookId: row.book_id, chapterId }
    });
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
    logActivity(req, {
      action: 'interactive.chapter.reorder',
      entityType: 'interactive_book',
      entityId: bookId,
      summary: `Reordered ${normalized.length} chapter${normalized.length === 1 ? '' : 's'} in "${trunc(book.title)}"`,
      metadata: { bookId, chapterIds: normalized }
    });
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
    logActivity(req, {
      action: 'interactive.block.create',
      entityType: 'interactive_block',
      entityId: block?.id ?? null,
      summary: `Added ${trunc(String(type), 30)} block to chapter "${trunc(row.chapter_title)}"`,
      metadata: {
        bookId: row.book_id,
        chapterId,
        blockId: block?.id ?? null,
        blockType: String(type)
      }
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
    const changed = [];
    if (type !== undefined) changed.push('type');
    if (contentJson !== undefined) changed.push('content');
    if (position !== undefined) changed.push('position');
    logActivity(req, {
      action: 'interactive.block.update',
      entityType: 'interactive_block',
      entityId: blockId,
      summary: `Updated ${trunc(updated?.type || row.type, 30)} block in chapter ${row.chapter_id}`,
      metadata: {
        bookId: row.book_id,
        chapterId: row.chapter_id,
        blockId,
        blockType: updated?.type || row.type,
        changed
      }
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
    logActivity(req, {
      action: 'interactive.block.delete',
      entityType: 'interactive_block',
      entityId: blockId,
      summary: `Deleted ${trunc(row.type, 30)} block from chapter ${row.chapter_id}`,
      metadata: {
        bookId: row.book_id,
        chapterId: row.chapter_id,
        blockId,
        blockType: row.type
      }
    });
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
    logActivity(req, {
      action: 'interactive.block.reorder',
      entityType: 'interactive_chapter',
      entityId: chapterId,
      summary: `Reordered ${normalized.length} block${normalized.length === 1 ? '' : 's'} in chapter "${trunc(chapter.chapter_title)}"`,
      metadata: { bookId: chapter.book_id, chapterId, blockIds: normalized }
    });
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
    logActivity(req, {
      action: 'interactive.book.export_epub',
      entityType: 'interactive_book',
      entityId: bookId,
      summary: `Exported EPUB (${includeInteractiveJs ? 'JS interactive' : 'strict fallback'}) for "${trunc(book.title)}"`,
      metadata: {
        bookId,
        chapters: chapters.length,
        includeInteractiveJs,
        fileName
      }
    });
    return res.end(buf, 'binary');
  } catch (e) {
    return errorResponse(res, e.message, 500);
  }
});

export default router;

