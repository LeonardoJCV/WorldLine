import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const nonPortableMath = [
  'random',
  'exp',
  'expm1',
  'log',
  'log1p',
  'log2',
  'log10',
  'pow',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'sinh',
  'cosh',
  'tanh',
  'asinh',
  'acosh',
  'atanh',
  'cbrt',
  'hypot',
]

export default defineConfig(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results', 'screens'] },
  js.configs.recommended,
  tseslint.configs.strict,
  {
    files: ['src/**/*.tsx', 'src/**/*.ts'],
    ...reactHooks.configs.flat.recommended,
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['scripts/**/*.ts', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/engine/**/*.ts'],
    ignores: ['src/engine/**/*.test.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...nonPortableMath.map((property) => ({
          object: 'Math',
          property,
          message: 'Resultado varia entre engines JS. Use engine/math.ts.',
        })),
      ],
      'no-restricted-globals': [
        'error',
        'Date',
        'performance',
        'crypto',
        'window',
        'document',
        'self',
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "BinaryExpression[operator='**']", message: 'Use pow() de engine/math.ts.' },
        {
          selector: "AssignmentExpression[operator='**=']",
          message: 'Use pow() de engine/math.ts.',
        },
      ],
      'no-restricted-imports': [
        'error',
        { patterns: ['react', 'react-dom', 'react/*', '**/app/**', '**/worker/**'] },
      ],
    },
  },
)
