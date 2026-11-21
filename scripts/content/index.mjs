import * as builders from './builders.mjs';
import * as creators from './creators.mjs';
import * as embedded from './embedded.mjs';
import * as links from './links.mjs';
import { codes } from './codes.mjs';
import {
  createCompendiumDocument,
  requireWritablePack,
  upsertCompendiumDocument,
  validateContentSource,
} from './persistence.mjs';

export * from './builders.mjs';
export * from './creators.mjs';
export * from './embedded.mjs';
export * from './links.mjs';
export * from './codes.mjs';
export {
  createCompendiumDocument,
  requireWritablePack,
  upsertCompendiumDocument,
  validateContentSource,
} from './persistence.mjs';

export const content = Object.freeze({
  ...builders,
  ...creators,
  ...embedded,
  ...links,
  createCompendiumDocument,
  requireWritablePack,
  upsertCompendiumDocument,
  validateContentSource,
  codes,
});
