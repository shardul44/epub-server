/**
 * Curated default params and repairs for all UI-exposed H5P content types.
 */
import { CURATED_MACHINE_NAMES } from './h5pContentTypes.js';
import {
  coerceH5pMediaFields,
  enforceSemanticsMinimums,
  semanticsToDefaultParams
} from './h5pSemanticsDefaults.js';

const DRAG_TEXT_SAMPLE =
  '*Oslo* is the capital of Norway, *Stockholm* is the capital of Sweden and *Copenhagen* is the capital of Denmark.';

const MARK_WORDS_SAMPLE =
  '<p>Click the *verbs* in this *sample* sentence.</p>';

const BLANKS_SAMPLE = '<p>Oslo is the capital of *Norway*.</p>';

/** One blank slide — Course Presentation requires at least one slide for the editor UI. */
export function coursePresentationEmptySlide() {
  return { elements: [], keywords: [] };
}

export function repairCoursePresentationParams(params) {
  if (!params || typeof params !== 'object') return params;
  const out = { ...params };
  const pres = out.presentation && typeof out.presentation === 'object' ? { ...out.presentation } : {};
  if (!Array.isArray(pres.slides) || pres.slides.length === 0) {
    pres.slides = [coursePresentationEmptySlide()];
  }
  out.presentation = pres;
  return out;
}

function hasAsteriskMarkers(text) {
  return /\*[^*\s][^*]*\*/.test(String(text ?? ''));
}

function repairDragTextParams(params) {
  const out = { ...params };
  if (!hasAsteriskMarkers(out.textField)) {
    out.textField = DRAG_TEXT_SAMPLE;
    if (!out.taskDescription) out.taskDescription = '<p>Drag the words into the correct boxes</p>';
  }
  return out;
}

function repairMarkTheWordsParams(params) {
  const out = { ...params };
  if (!hasAsteriskMarkers(out.textField)) {
    out.textField = MARK_WORDS_SAMPLE;
    if (!out.taskDescription) {
      out.taskDescription = '<p>Click on the correct words in the text.</p>';
    }
  }
  return out;
}

function repairBlanksParams(params) {
  const out = { ...params };
  let questions = Array.isArray(out.questions) ? [...out.questions] : [];
  questions = questions.map((q) => {
    if (typeof q === 'object' && q !== null && q.question != null) return q.question;
    return q;
  });
  if (questions.length === 0 || !questions.some((q) => hasAsteriskMarkers(q))) {
    questions = [BLANKS_SAMPLE];
  }
  out.questions = questions;
  return out;
}

function repairInteractiveVideoParams(params) {
  const out = { ...params };
  if (!out.interactiveVideo || typeof out.interactiveVideo !== 'object') {
    out.interactiveVideo = structuredClone(H5P_CONTENT_PARAM_DEFAULTS['H5P.InteractiveVideo'].interactiveVideo);
    return out;
  }
  const iv = { ...out.interactiveVideo };
  if (!iv.video || typeof iv.video !== 'object') {
    iv.video = structuredClone(H5P_CONTENT_PARAM_DEFAULTS['H5P.InteractiveVideo'].interactiveVideo.video);
  } else if (!Array.isArray(iv.video.files)) {
    iv.video = { ...iv.video, files: [] };
  }
  if (!iv.assets || typeof iv.assets !== 'object') {
    iv.assets = { interactions: [], bookmarks: [], endscreens: [] };
  }
  out.interactiveVideo = iv;
  return out;
}

function deepMergeDefaults(target, source) {
  if (!source || typeof source !== 'object') return target ?? {};
  const out = target && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
  for (const [key, val] of Object.entries(source)) {
    if (
      val &&
      typeof val === 'object' &&
      !Array.isArray(val) &&
      out[key] &&
      typeof out[key] === 'object' &&
      !Array.isArray(out[key])
    ) {
      out[key] = deepMergeDefaults(out[key], val);
    } else {
      out[key] = structuredClone(val);
    }
  }
  return out;
}

/** @type {Record<string, Record<string, unknown>>} */
export const H5P_CONTENT_PARAM_DEFAULTS = {
  'H5P.CoursePresentation': {
    presentation: {
      slides: [coursePresentationEmptySlide()],
      ct: '',
      keywordListEnabled: true,
      keywordListAlwaysShow: false,
      keywordListAutoHide: false,
      keywordListOpacity: 90,
      globalBackgroundSelector: {
        imageGlobalBackground: '',
        fillGlobalBackground: ''
      }
    }
  },
  'H5P.DragText': {
    taskDescription: '<p>Drag the words into the correct boxes</p>',
    textField: DRAG_TEXT_SAMPLE,
    distractors: '*Reykjavík* *Helsinki*'
  },
  'H5P.Blanks': {
    text: '<p>Fill in the missing words</p>',
    questions: [BLANKS_SAMPLE]
  },
  'H5P.MarkTheWords': {
    taskDescription: '<p>Click on the correct words in the text.</p>',
    textField: MARK_WORDS_SAMPLE
  },
  'H5P.MultiChoice': {
    question: '<p>Which answer is correct?</p>',
    answers: [
      { text: '<p>Correct option</p>', correct: true },
      { text: '<p>Wrong option</p>', correct: false }
    ]
  },
  'H5P.TrueFalse': {
    question: '<p>The earth is round.</p>'
  },
  'H5P.Essay': {
    taskDescription: '<p>Write your answer below.</p>',
    placeholderText: 'Enter your response…'
  },
  'H5P.InteractiveVideo': {
    interactiveVideo: {
      video: {
        files: [],
        startScreenOptions: {
          title: 'Interactive Video',
          hideStartTitle: false,
          shortStartDescription: ''
        },
        textTracks: {
          videoTrack: [{ label: 'Subtitles', kind: 'subtitles', srcLang: 'en', track: '' }],
          defaultTrackLabel: ''
        }
      },
      assets: { interactions: [], bookmarks: [], endscreens: [] }
    }
  },
  'H5P.Accordion': {
    panels: [
      {
        title: 'Section 1',
        content: {
          library: 'H5P.AdvancedText 1.1',
          params: { text: '<p>Add your content here.</p>' },
          metadata: null,
          subContentId: null
        }
      }
    ]
  },
  'H5P.Flashcards': {
    description: 'Study the cards and type the correct answer.',
    cards: [{ text: 'Sample question', answer: 'Sample answer' }]
  },
  'H5P.MemoryGame': {
    cards: [
      { image: {}, imageAlt: 'Card 1' },
      { image: {}, imageAlt: 'Card 2' }
    ]
  },
  'H5P.ImageHotspots': {
    hotspots: [
      {
        header: 'Hotspot 1',
        content: {
          library: 'H5P.AdvancedText 1.1',
          params: { text: '<p>Hotspot content</p>' },
          metadata: null,
          subContentId: null
        }
      }
    ]
  },
  'H5P.ImageSequencing': {
    taskDescription: 'Drag to arrange the images in the correct sequence',
    sequenceImages: [{ image: {}, imageDescription: 'Image 1' }, { image: {}, imageDescription: 'Image 2' }, { image: {}, imageDescription: 'Image 3' }]
  },
  'H5P.Crossword': {
    words: [
      { clue: 'Capital of Norway', answer: 'Oslo' },
      { clue: 'Capital of Sweden', answer: 'Stockholm' }
    ]
  },
  'H5P.ImageMultipleHotspotQuestion': {
    question: '<p>Find all the correct areas on the image.</p>',
    image: {},
    hotspots: []
  },
  'H5P.Timeline': {
    timeline: {
      headline: 'Timeline',
      text: '<p>Add events to build your timeline.</p>',
      date: [
        {
          headline: 'First event',
          text: '<p>Describe this event.</p>',
          startDate: '2020,1,1'
        }
      ]
    }
  },
  'H5P.BranchingScenario': {
    branchingScenario: {
      title: 'Branching Scenario'
    }
  }
};

/** Authoring hints shown in the UI (keep in sync with frontend h5pContentTypes.js). */
export const H5P_CONTENT_AUTHORING_HINTS = {
  'H5P.MultiChoice': 'Add a question and at least two answer options; mark the correct option(s).',
  'H5P.TrueFalse': 'Write a statement, then choose whether it is true or false.',
  'H5P.Blanks': 'Use *asterisks* around each blank in a text line, e.g. Oslo is the capital of *Norway*.',
  'H5P.DragText': 'Wrap droppable words in *asterisks* in the Text field, e.g. *Paris* is the capital of France.',
  'H5P.MarkTheWords': 'Wrap each correct word in *asterisks* in the text field.',
  'H5P.Essay': 'Set the task description; learners type a free-text response.',
  'H5P.InteractiveVideo': 'Upload a video, then add interactions (questions, labels, links) on the timeline.',
  'H5P.CoursePresentation':
    'Slide deck: use + at the bottom to add slides, then use the toolbar above the canvas to add elements.',
  'H5P.ImageHotspots': 'Upload a background image, then add hotspots with text or media.',
  'H5P.ImageSequencing': 'Add at least three images; learners drag them into the correct order.',
  'H5P.MemoryGame': 'Add pairs of cards (images); learners match pairs.',
  'H5P.Crossword': 'Add words and clues; the crossword grid is generated automatically.',
  'H5P.ImageMultipleHotspotQuestion': 'Upload an image and draw hotspot areas learners must find.',
  'H5P.Flashcards': 'Add cards with a question on the front and answer on the back.',
  'H5P.Accordion': 'Add panels; each panel has a title and expandable content.',
  'H5P.Timeline': 'Add dated events with headlines and descriptions.',
  'H5P.BranchingScenario': 'Build a flowchart of scenes; connect choices to different paths.'
};

export function getAuthoringHint(machineName) {
  return H5P_CONTENT_AUTHORING_HINTS[machineName] || null;
}

export function mergeContentTypeParamDefaults(machineName, params) {
  const overrides = H5P_CONTENT_PARAM_DEFAULTS[machineName];
  let merged = params ?? {};
  if (overrides) {
    merged = deepMergeDefaults(merged, overrides);
  }
  return repairContentParamsForLibrary(machineName, merged);
}

/** Type-specific + generic repairs applied on save, load, and draft creation. */
export function repairContentParamsForLibrary(machineName, params) {
  if (!params || typeof params !== 'object') return params ?? {};
  const out = structuredClone(params);

  coerceH5pMediaFields(out);

  switch (machineName) {
    case 'H5P.CoursePresentation':
      return repairCoursePresentationParams(out);
    case 'H5P.DragText':
      return repairDragTextParams(out);
    case 'H5P.MarkTheWords':
      return repairMarkTheWordsParams(out);
    case 'H5P.Blanks':
      return repairBlanksParams(out);
    case 'H5P.InteractiveVideo':
      return repairInteractiveVideoParams(out);
    default:
      return out;
  }
}

/**
 * Full pipeline: semantics mins → curated defaults → type repairs.
 * @param {string} machineName
 * @param {object} params
 * @param {object[]|null} semantics
 */
export function buildInitialContentParams(machineName, semantics) {
  const fromSemantics = semantics ? semanticsToDefaultParams(semantics) : {};
  const withMins = semantics ? enforceSemanticsMinimums(fromSemantics, semantics) : fromSemantics;
  return mergeContentTypeParamDefaults(machineName, withMins);
}

export function repairStoredContentParams(machineName, params, semantics = null) {
  let out = params && typeof params === 'object' ? structuredClone(params) : {};
  if (Array.isArray(out.questions)) {
    out.questions = out.questions.map((q) => {
      if (typeof q === 'object' && q !== null && q.question != null) return q.question;
      return q;
    });
  }
  if (semantics) {
    out = enforceSemanticsMinimums(out, semantics);
  }
  if (machineName) {
    return mergeContentTypeParamDefaults(machineName, out);
  }
  coerceH5pMediaFields(out);
  if (out.presentation != null) {
    return repairCoursePresentationParams(out);
  }
  return out;
}

export function contentParamsNeedRepair(machineName, before, after) {
  return JSON.stringify(before) !== JSON.stringify(after);
}

/** Detect at least one *droppable* token in Drag Text fields. */
export function dragTextHasDropZones(textField, distractors = '') {
  const combined = `${textField ?? ''} ${distractors ?? ''}`;
  return /\*[^*\s][^*]*\*/.test(combined);
}

export function getDragTextAuthoringHint() {
  return H5P_CONTENT_AUTHORING_HINTS['H5P.DragText'];
}

export function getCoursePresentationAuthoringHint() {
  return H5P_CONTENT_AUTHORING_HINTS['H5P.CoursePresentation'];
}

export function getContentPlaybackWarnings(libraryName, params) {
  if (libraryName === 'H5P.DragText' && !dragTextHasDropZones(params?.textField, params?.distractors)) {
    return [
      {
        code: 'drag-text-no-drop-zones',
        message:
          'This Drag Text activity has no drop zones. Edit it and wrap droppable words in asterisks, e.g. *word*.'
      }
    ];
  }
  if (libraryName === 'H5P.MarkTheWords' && !hasAsteriskMarkers(params?.textField)) {
    return [
      {
        code: 'mark-words-no-markers',
        message: 'This Mark the Words activity has no marked words. Wrap correct words in *asterisks*.'
      }
    ];
  }
  return [];
}

export { CURATED_MACHINE_NAMES, semanticsToDefaultParams, enforceSemanticsMinimums };
