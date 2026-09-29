import { z } from 'zod';
export const text = z.string().trim().min(1).max(10000);
export const identity = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
export const relativePathSchema = z
  .string()
  .min(1)
  .refine(
    (s) =>
      !s.includes('\\') &&
      !s.startsWith('/') &&
      !s.includes(':') &&
      !s.split('/').some((p) => !p || p === '.' || p === '..'),
    'Portable relative path required',
  );
export const digest = z.string().regex(/^[a-f0-9]{64}$/);
