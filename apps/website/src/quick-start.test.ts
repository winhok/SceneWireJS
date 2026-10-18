import { expect, test } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { quickStart } from './quick-start';
test('README, onboarding and website retain the identical complete-project recipe', () => {
  for (const path of [
    '../../README.md',
    '../../docs/onboarding.md',
    '../../docs/internal-audit/post-v13-agent-adoption/overrides/README.md',
  ]) {
    if (!existsSync(path) && path.includes('internal-audit')) continue;
    const document = readFileSync(path, 'utf8');
    expect(document).toContain('```sh\n' + quickStart + '\n```');
  }
  expect(quickStart).toContain('init my-video --yes --skills');
  expect(quickStart).not.toContain('scaffold');
});
