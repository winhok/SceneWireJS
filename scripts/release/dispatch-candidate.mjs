import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateIdentity } from './candidate.mjs';

// Candidate inventory is reviewed after source freeze and supplied outside the
// source tree. Preserve exact input UTF-8 bytes; never add a newline or rewrite JSON.
export function materializeCandidate(
  input,
  path,
  { sha, version, inventorySha256 },
) {
  if (
    typeof input !== 'string' ||
    !input ||
    Buffer.byteLength(input, 'utf8') > 65535
  )
    throw Error('Invalid dispatch candidate input');
  const bytes = Buffer.from(input, 'utf8');
  const candidate = JSON.parse(input);
  validateIdentity(candidate, { sha, version, inventorySha256, bytes });
  writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
  return candidate;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [path, sha, version, inventorySha256] = process.argv.slice(2);
  materializeCandidate(process.env.CANDIDATE_JSON, path, {
    sha,
    version,
    inventorySha256,
  });
}
