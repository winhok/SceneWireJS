import { createEditorialRegistry } from '@scenewirejs/domain-editorial';
import { createDeveloperRegistry } from '@scenewirejs/domain-developer';
import { createEducationRegistry } from '@scenewirejs/domain-education';
import { createPrimitiveRegistry } from '@scenewirejs/runtime';
// App-owned definitions; grammar setup occurs once, before frame playback.
export const componentRegistry = Object.freeze([
  ...createPrimitiveRegistry(),
  ...createDeveloperRegistry(),
  ...createEducationRegistry(),
  ...createEditorialRegistry(),
]);
