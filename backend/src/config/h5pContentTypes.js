/**
 * Curated H5P content types exposed in the authoring UI.
 * machineName must match installed H5P libraries (H5P Hub).
 */
export const H5P_CONTENT_CATEGORIES = [
  {
    id: 'assessment',
    label: 'Assessment',
    types: [
      {
        id: 'multiple-choice',
        label: 'Multiple Choice',
        machineName: 'H5P.MultiChoice',
        icon: 'quiz',
        hint: 'Add a question and at least two answer options; mark the correct option(s).'
      },
      {
        id: 'true-false',
        label: 'True/False',
        machineName: 'H5P.TrueFalse',
        icon: 'quiz',
        hint: 'Write a statement, then choose whether it is true or false.'
      },
      {
        id: 'fill-blanks',
        label: 'Fill in the Blanks',
        machineName: 'H5P.Blanks',
        icon: 'quiz',
        hint: 'Use *asterisks* around each blank in a text line, e.g. Oslo is the capital of *Norway*.'
      },
      {
        id: 'drag-text',
        label: 'Drag Text',
        machineName: 'H5P.DragText',
        icon: 'quiz',
        hint: 'Wrap droppable words in asterisks in the Text field, e.g. *Paris* is the capital of France.'
      },
      {
        id: 'mark-words',
        label: 'Mark the Words',
        machineName: 'H5P.MarkTheWords',
        icon: 'quiz',
        hint: 'Wrap each correct word in *asterisks* in the text field.'
      },
      {
        id: 'essay',
        label: 'Essay',
        machineName: 'H5P.Essay',
        icon: 'quiz',
        hint: 'Set the task description; learners type a free-text response.'
      }
    ]
  },
  {
    id: 'interactive-media',
    label: 'Interactive Media',
    types: [
      {
        id: 'interactive-video',
        label: 'Interactive Video',
        machineName: 'H5P.InteractiveVideo',
        icon: 'video',
        hint: 'Upload a video, then add interactions (questions, labels, links) on the timeline.'
      },
      {
        id: 'course-presentation',
        label: 'Course Presentation',
        machineName: 'H5P.CoursePresentation',
        icon: 'slides',
        hint: 'Slide deck: add slides with +, then place text, images, or quizzes on each slide from the toolbar above the canvas.'
      },
      {
        id: 'image-hotspots',
        label: 'Image Hotspots',
        machineName: 'H5P.ImageHotspots',
        icon: 'image',
        hint: 'Upload a background image, then add hotspots with text or media.'
      },
      {
        id: 'image-sequencing',
        label: 'Image Sequencing',
        machineName: 'H5P.ImageSequencing',
        icon: 'image',
        hint: 'Add at least three images; learners drag them into the correct order.'
      }
    ]
  },
  {
    id: 'games',
    label: 'Games',
    types: [
      {
        id: 'memory-game',
        label: 'Memory Game',
        machineName: 'H5P.MemoryGame',
        icon: 'game',
        hint: 'Add pairs of cards (images); learners match pairs.'
      },
      {
        id: 'crossword',
        label: 'Crossword',
        machineName: 'H5P.Crossword',
        icon: 'game',
        hint: 'Add words and clues; the crossword grid is generated automatically.'
      },
      {
        id: 'find-multiple-hotspots',
        label: 'Find Multiple Hotspots',
        machineName: 'H5P.ImageMultipleHotspotQuestion',
        icon: 'game',
        hint: 'Upload an image and draw hotspot areas learners must find.'
      }
    ]
  },
  {
    id: 'learning-objects',
    label: 'Learning Objects',
    types: [
      {
        id: 'flashcards',
        label: 'Flashcards',
        machineName: 'H5P.Flashcards',
        icon: 'cards',
        hint: 'Add cards with a question on the front and answer on the back.'
      },
      {
        id: 'accordion',
        label: 'Accordion',
        machineName: 'H5P.Accordion',
        icon: 'accordion',
        hint: 'Add panels; each panel has a title and expandable content.'
      },
      {
        id: 'timeline',
        label: 'Timeline',
        machineName: 'H5P.Timeline',
        icon: 'timeline',
        hint: 'Add dated events with headlines and descriptions.'
      },
      {
        id: 'branching-scenario',
        label: 'Branching Scenario',
        machineName: 'H5P.BranchingScenario',
        icon: 'branch',
        hint: 'Build a flowchart of scenes; connect choices to different paths.'
      }
    ]
  }
];

/** Flat list of all curated machine names */
export const CURATED_MACHINE_NAMES = new Set(
  H5P_CONTENT_CATEGORIES.flatMap((c) => c.types.map((t) => t.machineName))
);

export function findContentTypeByMachineName(machineName) {
  for (const cat of H5P_CONTENT_CATEGORIES) {
    const found = cat.types.find((t) => t.machineName === machineName);
    if (found) return { ...found, categoryId: cat.id, categoryLabel: cat.label };
  }
  return null;
}

export function findContentTypeById(typeId) {
  for (const cat of H5P_CONTENT_CATEGORIES) {
    const found = cat.types.find((t) => t.id === typeId);
    if (found) return { ...found, categoryId: cat.id, categoryLabel: cat.label };
  }
  return null;
}
