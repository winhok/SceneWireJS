import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { publishCanonical } from './npm-publish-payload-audit.mjs';

// Match npm's EOTP flow without changing canonical manifests or tarball bytes.
// The caller must independently confirm absence before the authenticated retry.
export async function publishWithAuthentication(
  npmCli,
  tarball,
  options,
  { authenticate, confirmAbsent },
) {
  try {
    return await publishCanonical(npmCli, tarball, options);
  } catch (error) {
    if (error.code !== 'EOTP' || error.statusCode !== 401) throw error;
    const otp = await authenticate(error, options);
    if (typeof otp !== 'string' || !otp)
      throw new Error('Authentication incomplete');
    if (!(await confirmAbsent()))
      throw new Error('Version absence not confirmed');
    // A definitive 401 challenge permits one authenticated submission, never a
    // blind retry after an ambiguous response. Do not persist the transient OTP.
    return publishCanonical(npmCli, tarball, { ...options, otp });
  }
}

// openBrowser must resolve after the caller verifies the visible npm page.
// Keeping UI control in the caller avoids treating OS command success as proof.
export async function authenticateInBrowser(
  npmCli,
  error,
  options,
  { openBrowser, timeoutMs = 300000 },
) {
  if (typeof openBrowser !== 'function')
    throw new Error('A verified browser opener is required');
  const { authUrl, doneUrl } = error.body ?? {};
  if (!authUrl || !doneUrl) {
    throw new Error('Browser challenge unavailable; interactive OTP required');
  }
  const auth = new URL(authUrl);
  const done = new URL(doneUrl);
  if (
    auth.protocol !== 'https:' ||
    auth.hostname !== 'www.npmjs.com' ||
    done.origin !== new URL(options.registry).origin
  )
    throw new Error('Unexpected npm authentication origin');
  const require = createRequire(resolve(npmCli));
  const { webAuthOpener } = require('npm-profile');
  const { token } = await webAuthOpener(
    async (url, { signal }) => {
      await openBrowser(url);
      await new Promise((resolve, reject) => {
        if (signal.aborted) return resolve();
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          reject(new Error('Browser authentication timed out'));
        }, timeoutMs);
        const onAbort = () => {
          clearTimeout(timer);
          resolve();
        };
        signal.addEventListener('abort', onAbort, { once: true });
      });
    },
    authUrl,
    doneUrl,
    options,
  );
  return token;
}
