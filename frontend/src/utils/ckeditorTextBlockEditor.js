/**
 * Shared CKEditor config for interactive text blocks (modal + enhanced editor).
 * Editor class must be loaded via `@ckeditor/ckeditor5-build-classic` (Vite alias → H5P bundle with font plugins).
 */

const FONT_FAMILY_OPTIONS = [
  'default',
  'Arial, Helvetica, sans-serif',
  'Courier New, Courier, monospace',
  'Garamond, Baskerville, "Times New Roman", serif',
  'Georgia, serif',
  'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif',
  'Lucida Sans Unicode, Lucida Grande, sans-serif',
  'Tahoma, Geneva, sans-serif',
  'Times New Roman, Times, serif',
  'Trebuchet MS, Helvetica, sans-serif',
  'Verdana, Geneva, sans-serif',
];

const FONT_SIZE_OPTIONS = [10, 12, 14, 16, 18, 20, 24, 28, 32];

/** Classic-like toolbar + font dropdowns after heading. */
export const TEXT_BLOCK_CKEDITOR_TOOLBAR_ITEMS = [
  'undo',
  'redo',
  '|',
  'heading',
  'fontFamily',
  'fontSize',
  '|',
  'bold',
  'italic',
  'underline',
  '|',
  'link',
  'imageUpload',
  'insertTable',
  'blockQuote',
  'mediaEmbed',
  '|',
  'bulletedList',
  'numberedList',
  '|',
  'outdent',
  'indent',
];

export function getTextBlockCkEditorConfig(placeholder) {
  return {
    placeholder: placeholder || 'Write lesson text…',
    toolbar: {
      items: TEXT_BLOCK_CKEDITOR_TOOLBAR_ITEMS,
      shouldNotGroupWhenFull: true,
    },
    fontFamily: {
      options: FONT_FAMILY_OPTIONS,
      supportAllValues: true,
    },
    fontSize: {
      options: ['default', ...FONT_SIZE_OPTIONS],
      supportAllValues: true,
    },
    image: {
      toolbar: [
        'imageTextAlternative',
        'toggleImageCaption',
        'imageStyle:inline',
        'imageStyle:block',
        'imageStyle:side',
      ],
    },
    table: {
      contentToolbar: [
        'toggleTableCaption',
        'tableColumn',
        'tableRow',
        'mergeTableCells',
        'tableCellProperties',
        'tableProperties',
      ],
    },
  };
}
