import { createConfig } from '@skepsik/eslint-config';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { importX } from 'eslint-plugin-import-x';

/** Относительный уход в соседний workspace-пакет. */
const crossPackageRelative = {
  message:
    'Cross-package imports only via @sherpa/<pkg> (not relative paths into sibling packages).',
  regex: '^(\\.\\./){2,}packages(/|$)',
};

const deepPackageSrc = {
  message: 'Import via package exports (@sherpa/...), not /src.',
  regex: '^@sherpa/[^/]+/src(/|$)',
};

/**
 * ESLint на весь монорепо. Локальный eslint.config.js пакета — только если
 * нужны другие плагины/правила.
 *
 * Стиль импортов: без расширений `.ts`/`.tsx`, без лишнего `/index`.
 */
export default createConfig(
  {
    rootDir: import.meta.dirname,
    typescript: {
      projectService: {
        allowDefaultProject: ['eslint.config.js'],
        typeChecked: true,
      },
      rules: {
        '@typescript-eslint/require-await': 'off',
      },
    },
  },
  {
    files: ['**/*.{cts,mts,ts,tsx}'],
    plugins: {
      'import-x': importX,
    },
    rules: {
      'import-x/extensions': [
        'error',
        {
          checkTypeImports: true,
          fix: true,
          ignorePackages: true,
          pattern: {
            css: 'always',
            cts: 'never',
            jpeg: 'always',
            jpg: 'always',
            js: 'never',
            json: 'always',
            jsx: 'never',
            mts: 'never',
            png: 'always',
            scss: 'always',
            svg: 'always',
            ts: 'never',
            tsx: 'never',
            webp: 'always',
          },
        },
      ],
      'import-x/no-useless-path-segments': [
        'error',
        {
          noUselessIndex: true,
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [crossPackageRelative, deepPackageSrc],
        },
      ],
    },
    settings: {
      'import-x/extensions': [
        '.ts',
        '.tsx',
        '.cts',
        '.mts',
        '.js',
        '.jsx',
        '.cjs',
        '.mjs',
      ],
      'import-x/resolver-next': [createTypeScriptImportResolver()],
    },
  },
  {
    files: ['packages/bot/**/*.{cts,mts,ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            crossPackageRelative,
            deepPackageSrc,
            {
              message: 'Runner is not importable from bot.',
              regex: '^@sherpa/runner(/|$)',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/runner/**/*.{cts,mts,ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            crossPackageRelative,
            deepPackageSrc,
            {
              message: 'Bot is not importable from runner.',
              regex: '^@sherpa/bot(/|$)',
            },
          ],
        },
      ],
    },
  },
);
