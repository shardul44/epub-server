import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { PdfToHtmlService } from './PdfToHtmlService.js';
import { HtmlParserService } from './HtmlParserService.js';
import { ReadingOrderService } from './ReadingOrderService.js';
import { WordSegmentationService } from './WordSegmentationService.js';
import { SentenceSegmentationService } from './SentenceSegmentationService.js';
import { CoordinateService } from './CoordinateService.js';
import { EpubGenerationService } from './EpubGenerationService.js';
import { getJobDirectoryLayout, JOB_SUBDIRS } from '../utils/jobPaths.js';
import { createLogger } from '../utils/logger.js';
import type { ConversionOptions, CoordsJson } from '../types.js';
import { pdfPipelineJobStore } from '../store/pdfPipelineJobStore.js';

const log = createLogger('PdfConversion');

const DEFAULT_PAGE_BATCH = parseInt(process.env.PDF_PIPELINE_PAGE_BATCH || '25', 10);

export class PdfConversionService {
  /**
   * Full pipeline: PDF → pdf2htmlEX → reading order → words → sentences → coords.json → EPUB + SMIL
   */
  static async convert(
    jobId: string,
    options: ConversionOptions = {}
  ): Promise<{ coords: CoordsJson; epubPath: string }> {
    const job = pdfPipelineJobStore.get(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);

    const layout = getJobDirectoryLayout(job.jobDir);
    const pageBatchSize = options.pageBatchSize ?? DEFAULT_PAGE_BATCH;

    try {
      pdfPipelineJobStore.update(jobId, {
        status: 'IN_PROGRESS',
        progress: 5,
        step: 'Converting PDF to HTML via pdf2htmlEX',
      });

      const htmlResult = await PdfToHtmlService.convert(layout, {
        splitPages: options.splitPages ?? true,
      });

      pdfPipelineJobStore.update(jobId, {
        progress: 25,
        step: 'Parsing HTML and extracting text elements',
      });

      const { elements, pages: rawPages } = await HtmlParserService.parseHtmlFiles(
        htmlResult.htmlFiles,
        htmlResult.cssFiles
      );

      pdfPipelineJobStore.update(jobId, {
        progress: 40,
        step: 'Reconstructing reading order',
      });

      const ordered = ReadingOrderService.reconstruct(elements);

      pdfPipelineJobStore.update(jobId, {
        progress: 55,
        step: 'Segmenting words and sentences',
      });

      if (rawPages.length > pageBatchSize) {
        log.info('Large PDF detected', { pages: rawPages.length, batchSize: pageBatchSize });
      }

      const allWords = WordSegmentationService.segment(ordered);

      const sentences = SentenceSegmentationService.segmentByElements(ordered, allWords);

      const pages = rawPages.map((p) => ({
        number: p.number,
        width: p.width,
        height: p.height,
        fileName: `page_${p.number}.xhtml`,
      }));

      pdfPipelineJobStore.update(jobId, {
        progress: 70,
        step: 'Writing coords.json',
      });

      const coords = await CoordinateService.produce(
        layout.coords,
        pages,
        allWords,
        sentences,
        layout.sourcePdf
      );

      pdfPipelineJobStore.update(jobId, {
        progress: 85,
        step: 'Generating Fixed Layout EPUB and SMIL',
        coordsPath: layout.coords,
        pageCount: pages.length,
        wordCount: allWords.length,
        sentenceCount: sentences.length,
      });

      const epubPath = await EpubGenerationService.generate(
        {
          epub: layout.epub,
          smil: layout.smil,
          css: layout.css,
          images: layout.images,
          fonts: layout.fonts,
          outputEpub: layout.outputEpub,
        },
        coords,
        options,
        ordered,
        htmlResult.htmlFiles
      );

      pdfPipelineJobStore.complete(jobId, {
        coordsPath: layout.coords,
        epubPath,
        pageCount: pages.length,
        wordCount: allWords.length,
        sentenceCount: sentences.length,
      });

      log.info('Conversion complete', { jobId, words: allWords.length, sentences: sentences.length });
      return { coords, epubPath };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pdfPipelineJobStore.fail(jobId, message);
      log.error('Conversion failed', { jobId, error: message });
      throw error;
    }
  }

  static async initializeJob(jobId: string, sourcePdfPath: string): Promise<string> {
    const backendRoot = path.resolve(fileURLToPath(import.meta.url), '../../../..');
    const jobsRoot = process.env.PDF_PIPELINE_JOBS_DIR
      ? path.isAbsolute(process.env.PDF_PIPELINE_JOBS_DIR)
        ? process.env.PDF_PIPELINE_JOBS_DIR
        : path.join(backendRoot, process.env.PDF_PIPELINE_JOBS_DIR)
      : path.join(backendRoot, 'pdf_pipeline_jobs');

    const jobDir = path.join(jobsRoot, jobId);
    const layout = getJobDirectoryLayout(jobDir);

    await fs.mkdir(jobDir, { recursive: true });
    for (const sub of JOB_SUBDIRS) {
      await fs.mkdir(path.join(jobDir, sub), { recursive: true });
    }

    await fs.copyFile(sourcePdfPath, layout.sourcePdf);

    const now = new Date().toISOString();
    pdfPipelineJobStore.create({
      id: jobId,
      status: 'PENDING',
      progress: 0,
      step: 'Job created',
      sourcePdfPath: layout.sourcePdf,
      jobDir,
      createdAt: now,
      updatedAt: now,
    });

    return jobDir;
  }
}
