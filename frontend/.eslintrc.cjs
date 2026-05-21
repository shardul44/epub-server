/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', 'node_modules'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  settings: {
    react: { version: 'detect' },
  },
  plugins: ['react-refresh'],
  rules: {
    'react/prop-types': 'off',
    'react/react-in-jsx-scope': 'off',
    'react/no-unescaped-entities': 'off',
    'react/display-name': 'off',
    'react-refresh/only-export-components': 'off',
    'no-unused-vars': 'off',
    'react-hooks/exhaustive-deps': 'off',
    'no-case-declarations': 'off',
    'no-useless-escape': 'off',
    'no-empty': ['error', { allowEmptyCatch: true }],
  },
  overrides: [
    {
      files: ['scripts/**/*.{js,mjs}'],
      env: { node: true, browser: false },
    },
    {
      files: [
        'src/components/EpubImageEditor.jsx',
        'src/pages/SyncStudio.jsx',
        'src/components/GrapesJSCanvas.jsx',
        'src/components/SyncStudioEpubReader.jsx',
        'src/components/PdfCard.jsx',
      ],
      rules: {
        'react-hooks/rules-of-hooks': 'off',
        'no-undef': 'off',
      },
    },
  ],
};
