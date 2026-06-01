/** UI catalog — keep in sync with backend/src/config/h5pContentTypes.js */

export const H5P_CONTENT_CATEGORIES = [

  {

    id: 'assessment',

    label: 'Assessment',

    types: [

      {

        id: 'multiple-choice',

        label: 'Multiple Choice',

        machineName: 'H5P.MultiChoice',

        icon: 'Quiz',

        hint: 'Add a question and at least two answer options; mark the correct option(s).',

      },

      {

        id: 'true-false',

        label: 'True/False',

        machineName: 'H5P.TrueFalse',

        icon: 'Quiz',

        hint: 'Write a statement, then choose whether it is true or false.',

      },

      {

        id: 'fill-blanks',

        label: 'Fill in the Blanks',

        machineName: 'H5P.Blanks',

        icon: 'Quiz',

        hint: 'Use *asterisks* around each blank, e.g. Oslo is the capital of *Norway*.',

      },

      {

        id: 'drag-text',

        label: 'Drag Text',

        machineName: 'H5P.DragText',

        icon: 'Quiz',

        hint: 'Wrap droppable words in *asterisks* in the Text field, e.g. *Paris* is the capital of France.',

      },

      {

        id: 'mark-words',

        label: 'Mark the Words',

        machineName: 'H5P.MarkTheWords',

        icon: 'Quiz',

        hint: 'Wrap each correct word in *asterisks* in the text field.',

      },

      {

        id: 'essay',

        label: 'Essay',

        machineName: 'H5P.Essay',

        icon: 'Quiz',

        hint: 'Set the task description; learners type a free-text response.',

      },

    ],

  },

  {

    id: 'interactive-media',

    label: 'Interactive Media',

    types: [

      {

        id: 'interactive-video',

        label: 'Interactive Video',

        machineName: 'H5P.InteractiveVideo',

        icon: 'OndemandVideo',

        hint: 'Upload a video, then add interactions (questions, labels, links) on the timeline.',

      },

      {

        id: 'course-presentation',

        label: 'Course Presentation',

        machineName: 'H5P.CoursePresentation',

        icon: 'Slideshow',

        hint: 'Slide deck: use + at the bottom to add slides, then use the toolbar above the canvas to add elements.',

      },

      {

        id: 'image-hotspots',

        label: 'Image Hotspots',

        machineName: 'H5P.ImageHotspots',

        icon: 'Image',

        hint: 'Upload a background image, then add hotspots with text or media.',

      },

      {

        id: 'image-sequencing',

        label: 'Image Sequencing',

        machineName: 'H5P.ImageSequencing',

        icon: 'Collections',

        hint: 'Add at least three images; learners drag them into the correct order.',

      },

    ],

  },

  {

    id: 'games',

    label: 'Games',

    types: [

      {

        id: 'memory-game',

        label: 'Memory Game',

        machineName: 'H5P.MemoryGame',

        icon: 'SportsEsports',

        hint: 'Add pairs of cards (images); learners match pairs.',

      },

      {

        id: 'crossword',

        label: 'Crossword',

        machineName: 'H5P.Crossword',

        icon: 'GridOn',

        hint: 'Add words and clues; the crossword grid is generated automatically.',

      },

      {

        id: 'find-multiple-hotspots',

        label: 'Find Multiple Hotspots',

        machineName: 'H5P.ImageMultipleHotspotQuestion',

        icon: 'TouchApp',

        hint: 'Upload an image and draw hotspot areas learners must find.',

      },

    ],

  },

  {

    id: 'learning-objects',

    label: 'Learning Objects',

    types: [

      {

        id: 'flashcards',

        label: 'Flashcards',

        machineName: 'H5P.Flashcards',

        icon: 'Style',

        hint: 'Add cards with a question on the front and answer on the back.',

      },

      {

        id: 'accordion',

        label: 'Accordion',

        machineName: 'H5P.Accordion',

        icon: 'ViewAgenda',

        hint: 'Add panels; each panel has a title and expandable content.',

      },

      {

        id: 'timeline',

        label: 'Timeline',

        machineName: 'H5P.Timeline',

        icon: 'Timeline',

        hint: 'Add dated events with headlines and descriptions.',

      },

      {

        id: 'branching-scenario',

        label: 'Branching Scenario',

        machineName: 'H5P.BranchingScenario',

        icon: 'AccountTree',

        hint: 'Build a flowchart of scenes; connect choices to different paths.',

      },

    ],

  },

];


