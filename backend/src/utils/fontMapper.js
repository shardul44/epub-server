/**
 * Font Mapping Utility for PDF to Google Fonts
 * Helps resolve messy PDF font names (e.g. "ABCDEE+Arial-BoldMT") 
 * to professional Google Font equivalents.
 */

const FONT_MAP = {
    'arial': 'Arial, sans-serif',
    'helvetica': 'Helvetica, Arial, sans-serif',
    'times': '"Times New Roman", Times, serif',
    'timesnewroman': '"Times New Roman", Times, serif',
    'courier': '"Courier New", Courier, monospace',
    'georgia': 'Georgia, serif',
    'verdana': 'Verdana, sans-serif',
    'trebuchet': '"Trebuchet MS", sans-serif',
    'comic': '"Comic Sans MS", cursive',
    'impact': 'Impact, charcoal, sans-serif',
    'myriad': '"Myriad Pro", Arial, sans-serif',
    'minion': '"Minion Pro", "Times New Roman", serif',
    'garamond': 'Garamond, "EB Garamond", serif',
    // TCM / TIME For Kids: map wide PDF fonts to similar-width system fonts to reduce FXL gap
    'futura': '"Trebuchet MS", sans-serif',
    'futuraextrabold': '"Trebuchet MS", sans-serif',
    'bodoni': '"Bodoni MT", serif',
    'frutiger': 'Frutiger, Arial, sans-serif',
    'univers': 'Univers, Arial, sans-serif',
    'optima': 'Optima, sans-serif',
    'gill': '"Gill Sans", sans-serif',
    'century': '"Century Gothic", sans-serif',
    'franklin': '"Arial Narrow", Arial, sans-serif',
    'franklingothic': '"Arial Narrow", Arial, sans-serif',
    'calibri': 'Calibri, Arial, sans-serif',
    'cambria': 'Cambria, "Times New Roman", serif',
    'roboto': 'Roboto, sans-serif',
    'open': '"Open Sans", sans-serif',
    'lato': 'Lato, sans-serif',
    'montserrat': 'Montserrat, sans-serif',
    'oswald': 'Oswald, sans-serif',
    'noto': '"Noto Sans", sans-serif',
    'lora': 'Lora, serif',
    'playfair': '"Playfair Display", serif',
    // Special combinations
    'monotypecorsiva': '"Monotype Corsiva", cursive',
    'zapfdingbats': '"Zapf Dingbats", sans-serif'
};

/**
 * Resolve a PDF font name to a clean CSS font-family string.
 * @param {string} pdfFontName 
 * @returns {string}
 */
export function resolveFontFamily(pdfFontName) {
    if (!pdfFontName) return 'Arial, sans-serif';

    // 1. Clean up "ABCDEE+FontName-Style" pattern
    let cleanName = pdfFontName.replace(/^[A-Z]{6}\+/, ''); // Remove subset prefix
    cleanName = cleanName.split('-')[0]; // Remove weight/style suffix like "-Bold"
    cleanName = cleanName.split(',')[0]; // Remove variations

    const searchKey = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '');

    // 2. Check exact mapping or partial match
    if (FONT_MAP[searchKey]) return FONT_MAP[searchKey];

    // 3. Fallback logic: check if any key is contained
    for (const [key, val] of Object.entries(FONT_MAP)) {
        if (searchKey.includes(key)) return val;
    }

    // 4. Ultimate fallback
    return `${cleanName}, Arial, sans-serif`;
}

/**
 * Get Google Font import URL for common modern fonts used in PDFs.
 */
export function getGoogleFontImports() {
    const fonts = [
        'Roboto:wght@400;700',
        'Open+Sans:wght@400;700',
        'Lato:wght@400;700',
        'Montserrat:wght@400;700',
        'Lora:wght@400;700',
        'Playfair+Display:wght@400;700',
        'EB+Garamond:wght@400;700',
        'Noto+Sans:wght@400;700'
    ];
    return `@import url('https://fonts.googleapis.com/css2?family=${fonts.join('&family=')}&display=swap');`;
}
