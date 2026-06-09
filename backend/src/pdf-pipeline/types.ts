export type JobStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

export interface WordModel {
  id: string;
  text: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
  fontFamily?: string;
  stableKey?: string;
  /** Index of the source HtmlTextElement in reading-order array */
  elementIndex?: number;
}

export interface SentenceModel {
  id: string;
  text: string;
  words: string[];
  page: number;
  /** DOM index of the pdf2htmlEX .t div on this page (for SMIL id injection) */
  domIndex?: number;
}

export interface PageModel {
  number: number;
  width: number;
  height: number;
  fileName?: string;
}

export interface CoordsJson {
  pages: PageModel[];
  words: WordModel[];
  sentences: SentenceModel[];
  metadata?: {
    generatedAt: string;
    sourcePdf: string;
    totalPages: number;
    idScheme: string;
  };
}

export interface HtmlTextElement {
  text: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
  fontFamily?: string;
  elementId?: string;
  rawClasses?: string;
  /** Zero-based index of this .t div in the pdf2htmlEX page HTML */
  domIndex?: number;
}

export interface PdfPipelineJob {
  id: string;
  status: JobStatus;
  progress: number;
  step: string;
  error?: string;
  sourcePdfPath?: string;
  jobDir: string;
  coordsPath?: string;
  epubPath?: string;
  createdAt: string;
  updatedAt: string;
  pageCount?: number;
  wordCount?: number;
  sentenceCount?: number;
}

export interface ConversionOptions {
  title?: string;
  author?: string;
  language?: string;
  splitPages?: boolean;
  pageBatchSize?: number;
}

export interface SmilTiming {
  sentenceId: string;
  begin: number;
  end: number;
  textFragment: string;
}
