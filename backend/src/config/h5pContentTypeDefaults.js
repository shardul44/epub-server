/**
 * Curated default params and repairs for all UI-exposed H5P content types.
 */
import { CURATED_MACHINE_NAMES } from './h5pContentTypes.js';
import {
  coerceH5pMediaFields,
  enforceSemanticsMinimums,
  semanticsToDefaultParams,
  stripEmptyNestedSingleFieldGroups
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
  if (!iv.summary || typeof iv.summary !== 'object') {
    iv.summary = structuredClone(H5P_CONTENT_PARAM_DEFAULTS['H5P.InteractiveVideo'].interactiveVideo.summary);
  } else {
    const summary = { ...iv.summary };
    let task = summary.task;
    if (!task || typeof task !== 'object' || typeof task.library !== 'string') {
      task = structuredClone(H5P_CONTENT_PARAM_DEFAULTS['H5P.InteractiveVideo'].interactiveVideo.summary.task);
    } else {
      task = {
        ...task,
        params:
          task.params && typeof task.params === 'object'
            ? repairKnownNestedLibraryParams(task.library, task.params)
            : repairKnownNestedLibraryParams(task.library, {}),
        metadata: task.metadata && typeof task.metadata === 'object' ? task.metadata : {},
        subContentId: task.subContentId ?? null
      };
    }
    if (summary.displayAt == null) summary.displayAt = 3;
    summary.task = task;
    iv.summary = summary;
  }
  out.interactiveVideo = iv;
  return out;
}

/** Branching Scenario content nodes need nested BranchingQuestion params. */
function repairBranchingScenarioParams(params) {
  const out = { ...params };
  if (!out.branchingScenario || typeof out.branchingScenario !== 'object') {
    out.branchingScenario = structuredClone(H5P_CONTENT_PARAM_DEFAULTS['H5P.BranchingScenario'].branchingScenario);
    return out;
  }
  const bs = { ...out.branchingScenario };
  if (!Array.isArray(bs.content) || bs.content.length === 0) {
    bs.content = structuredClone(H5P_CONTENT_PARAM_DEFAULTS['H5P.BranchingScenario'].branchingScenario.content);
  } else {
    bs.content = bs.content.map((item, index) => {
      if (!item || typeof item !== 'object') return item;
      const row = { ...item };
      let type = row.type;
      if (!type || typeof type !== 'object' || typeof type.library !== 'string') {
        type = structuredClone(H5P_CONTENT_PARAM_DEFAULTS['H5P.BranchingScenario'].branchingScenario.content[0].type);
      } else if (type.library.startsWith('H5P.BranchingQuestion')) {
        type = {
          ...type,
          params: repairKnownNestedLibraryParams(
            type.library,
            type.params && typeof type.params === 'object' ? type.params : {}
          ),
          metadata: type.metadata && typeof type.metadata === 'object' ? type.metadata : {},
          subContentId: type.subContentId ?? null
        };
      } else {
        type = {
          ...type,
          params: type.params && typeof type.params === 'object' ? type.params : {},
          metadata: type.metadata && typeof type.metadata === 'object' ? type.metadata : {},
          subContentId: type.subContentId ?? null
        };
      }
      row.type = type;
      return row;
    });
  }
  if (!String(bs.title ?? '').trim()) {
    bs.title = 'Branching Scenario';
  }
  out.branchingScenario = bs;
  return out;
}

/** Remove empty card images and optional tip groups that crash SemanticsEnforcer. */
function repairFlashcardsParams(params) {
  const out = { ...params };
  if (!Array.isArray(out.cards)) return out;
  out.cards = out.cards.map((card) => {
    if (!card || typeof card !== 'object') return card;
    const c = { ...card };
    if (c.image && typeof c.image === 'object' && !c.image.path) {
      delete c.image;
    }
    if (typeof c.imageAltText === 'string' && !c.imageAltText.trim()) {
      delete c.imageAltText;
    }
    stripEmptyNestedSingleFieldGroups(c);
    return c;
  });
  return out;
}

/** Hotspot popup `content` is a semantics list — must be an array, not a single library object. */
function repairImageHotspotsParams(params) {
  const out = { ...params };
  if (!Array.isArray(out.hotspots)) return out;

  out.hotspots = out.hotspots.map((hotspot) => {
    if (!hotspot || typeof hotspot !== 'object') return hotspot;
    const h = { ...hotspot };

    let content = h.content;
    if (content != null && !Array.isArray(content)) {
      content = typeof content === 'object' && content.library ? [content] : [];
    }
    if (!Array.isArray(content)) {
      content = [];
    }
    h.content = content.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const lib = item.library;
      const base = {
        ...item,
        params: item.params && typeof item.params === 'object' ? item.params : {},
        metadata: item.metadata != null && typeof item.metadata === 'object' ? item.metadata : {},
        subContentId: item.subContentId ?? null
      };
      if (typeof lib === 'string' && lib.startsWith('H5P.AdvancedText')) {
        return {
          ...base,
          library: 'H5P.Text 1.1',
          params: item.params?.text != null ? { text: item.params.text } : { text: '<p>Hotspot content</p>' }
        };
      }
      return base;
    });

    if (!h.position || typeof h.position !== 'object' || Array.isArray(h.position)) {
      h.position = { x: 50, y: 50, legacyPositioning: false };
    }

    return h;
  });

  if (out.image && typeof out.image === 'object' && !out.image.path) {
    delete out.image;
  }

  return out;
}

function isEmptyDefaultSlot(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object' && Object.keys(value).length === 0) return true;
  return false;
}

/** Fill only missing keys — never replace user lists, media paths, or edited text. */
function deepMergeDefaults(target, source) {
  if (!source || typeof source !== 'object') return target ?? {};
  const out = target && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
  for (const [key, val] of Object.entries(source)) {
    const existing = out[key];
    if (
      val &&
      typeof val === 'object' &&
      !Array.isArray(val) &&
      existing &&
      typeof existing === 'object' &&
      !Array.isArray(existing)
    ) {
      out[key] = deepMergeDefaults(existing, val);
      continue;
    }
    if (isEmptyDefaultSlot(existing)) {
      out[key] = structuredClone(val);
    }
  }
  return out;
}

const NESTED_TEXT_LIBRARY_DEFAULT = '<p>Add your content here.</p>';

/** H5P.Summary nested in Interactive Video — editor reads `params.intro`. */
export function defaultSummaryParams() {
  return {
    intro: 'Choose the correct statement.',
    summaries: [
      {
        summary: ['<p>Correct statement</p>', '<p>Incorrect statement</p>']
      }
    ],
    solvedLabel: 'Progress:',
    scoreLabel: 'Wrong answers:',
    resultLabel: 'Your result',
    labelCorrect: 'Correct.',
    labelIncorrect: 'Incorrect! Please try again.',
    alternativeIncorrectLabel: 'Incorrect',
    labelCorrectAnswers: 'Correct answers.',
    tipButtonLabel: 'Show tip',
    scoreBarLabel: 'You got :num out of :total points',
    progressText: 'Progress :num of :total'
  };
}

/** H5P.BranchingQuestion nested in Branching Scenario — editor reads `params.branchingQuestion`. */
export function defaultBranchingQuestionParams() {
  return {
    branchingQuestion: {
      question: '<p>What would you like to do?</p>',
      alternatives: [
        {
          text: 'Option A',
          nextContentId: -1,
          feedback: { title: '', subtitle: '', endScreenScore: 0 }
        },
        {
          text: 'Option B',
          nextContentId: -1,
          feedback: { title: '', subtitle: '', endScreenScore: 0 }
        }
      ]
    }
  };
}

function repairKnownNestedLibraryParams(library, params) {
  if (typeof library !== 'string' || !library) return params ?? {};
  const base = params && typeof params === 'object' ? { ...params } : {};
  if (library.startsWith('H5P.Summary')) {
    return deepMergeDefaults(base, defaultSummaryParams());
  }
  if (library.startsWith('H5P.BranchingQuestion')) {
    return deepMergeDefaults(base, defaultBranchingQuestionParams());
  }
  if (library.startsWith('H5P.AdvancedText') || library.startsWith('H5P.Text')) {
    if (!String(base.text ?? '').trim()) {
      base.text = NESTED_TEXT_LIBRARY_DEFAULT;
    }
    return base;
  }
  return base;
}

function defaultAccordionPanel(title = 'Section 1') {
  return {
    title,
    content: {
      library: 'H5P.AdvancedText 1.1',
      params: { text: NESTED_TEXT_LIBRARY_DEFAULT },
      metadata: {},
      subContentId: null
    }
  };
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
      assets: { interactions: [], bookmarks: [], endscreens: [] },
      summary: {
        task: {
          library: 'H5P.Summary 1.10',
          params: defaultSummaryParams(),
          metadata: {},
          subContentId: null
        },
        displayAt: 3
      }
    }
  },
  'H5P.Accordion': {
    panels: [defaultAccordionPanel()]
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
        position: { x: 50, y: 50, legacyPositioning: false },
        alwaysFullscreen: false,
        header: 'Hotspot 1',
        content: [
          {
            library: 'H5P.Text 1.1',
            params: { text: '<p>Hotspot content</p>' },
            metadata: {},
            subContentId: null
          }
        ]
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
      title: 'Branching Scenario',
      content: [
        {
          type: {
            library: 'H5P.BranchingQuestion 1.0',
            params: defaultBranchingQuestionParams(),
            metadata: {},
            subContentId: null
          },
          showContentTitle: false,
          proceedButtonText: 'Proceed',
          forceContentFinished: 'useBehavioural',
          nextContentId: 0
        }
      ]
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

/** Accordion panels need title + nested AdvancedText with `params.text` or the editor crashes. */
function repairAccordionParams(params) {
  const out = { ...params };
  if (!Array.isArray(out.panels)) {
    out.panels = [defaultAccordionPanel()];
    return out;
  }

  out.panels = out.panels.map((panel, index) => {
    if (!panel || typeof panel !== 'object') return panel;
    const p = { ...panel };
    if (!String(p.title ?? '').trim()) {
      p.title = `Section ${index + 1}`;
    }

    let lib = p.content;
    if (!lib || typeof lib !== 'object' || typeof lib.library !== 'string') {
      lib = structuredClone(defaultAccordionPanel(p.title).content);
    } else {
      lib = {
        ...lib,
        params: lib.params && typeof lib.params === 'object' ? { ...lib.params } : {},
        metadata: lib.metadata && typeof lib.metadata === 'object' ? lib.metadata : {},
        subContentId: lib.subContentId ?? null
      };
      if (
        (lib.library.startsWith('H5P.AdvancedText') || lib.library.startsWith('H5P.Text')) &&
        !String(lib.params?.text ?? '').trim()
      ) {
        lib.params.text = NESTED_TEXT_LIBRARY_DEFAULT;
      }
    }
    p.content = lib;
    return p;
  });

  if (out.panels.length === 0) {
    out.panels = [defaultAccordionPanel()];
  }

  return out;
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
  stripEmptyNestedSingleFieldGroups(out);

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
    case 'H5P.ImageHotspots':
      return repairImageHotspotsParams(out);
    case 'H5P.Flashcards':
      return repairFlashcardsParams(out);
    case 'H5P.Accordion':
      return repairAccordionParams(out);
    case 'H5P.BranchingScenario':
      return repairBranchingScenarioParams(out);
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

/** H5P editor crashes if nested library entries use `metadata: null`. */
export function repairNestedLibraryMetadata(node) {
  if (node == null) return node;
  if (Array.isArray(node)) {
    return node.map(repairNestedLibraryMetadata);
  }
  if (typeof node !== 'object') return node;
  if (typeof node.library === 'string' && node.library) {
    const fixed = {
      ...node,
      params: node.params != null && typeof node.params === 'object' ? { ...node.params } : {},
      metadata: node.metadata != null && typeof node.metadata === 'object' ? node.metadata : {},
      subContentId: node.subContentId ?? null
    };
    fixed.params = repairKnownNestedLibraryParams(fixed.library, fixed.params);
    fixed.params = repairNestedLibraryMetadata(fixed.params);
    return fixed;
  }
  const out = { ...node };
  for (const key of Object.keys(out)) {
    out[key] = repairNestedLibraryMetadata(out[key]);
  }
  return out;
}

export function repairStoredContentParams(machineName, params, semantics = null, { forSave = false } = {}) {
  let out = params && typeof params === 'object' ? structuredClone(params) : {};
  out = repairNestedLibraryMetadata(out);
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
    out = mergeContentTypeParamDefaults(machineName, out);
    coerceH5pMediaFields(out);
    if (forSave) {
      return repairContentParamsForLibrary(machineName, out);
    }
  } else {
    coerceH5pMediaFields(out);
  }
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
