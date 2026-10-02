import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';
export default defineConfig(
  {
    ignores: ['**/dist/**', '.build/**', '**/node_modules/**'],
  },
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: [
      'apps/**/*.{ts,tsx}',
      'packages/**/*.{ts,tsx}',
      'scripts/**/*.{js,mjs,ts}',
      '*.ts',
      'eslint.config.js',
    ],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: { '@typescript-eslint/no-deprecated': 'error' },
  },
  {
    files: ['packages/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...['name', 'value'].flatMap((key) => [
          {
            selector: `Property[key.${key}='version'][value.type='Literal'][value.value>=8]`,
            message:
              'Use CURRENT_PROJECT_VERSION for current project construction.',
          },
          {
            selector: `Property[key.${key}='version'][value.type='TSAsExpression'][value.expression.value>=8]`,
            message:
              'Use CURRENT_PROJECT_VERSION for current project construction.',
          },
          {
            selector: `AssignmentExpression[left.property.${key}='version'][right.type='Literal'][right.value>=8]`,
            message:
              'Use CURRENT_PROJECT_VERSION for current project assignment.',
          },
          {
            selector: `BinaryExpression[operator=/^(==|===|!=|!==)$/][left.property.${key}='version'][right.type='Literal'][right.value>=8]`,
            message:
              'Compare current project version with CURRENT_PROJECT_VERSION.',
          },
          {
            selector: `BinaryExpression[operator=/^(==|===|!=|!==)$/][right.property.${key}='version'][left.type='Literal'][left.value>=8]`,
            message:
              'Compare current project version with CURRENT_PROJECT_VERSION.',
          },
        ]),
      ],
    },
  },
);
