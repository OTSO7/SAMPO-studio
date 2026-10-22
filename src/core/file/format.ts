/**
 * The `.sampo` save file: a single UTF-8 JSON document.
 *
 * JSON rather than a binary format so a damaged file can still be opened and repaired by hand,
 * and a single file rather than a folder so it is trivial to back up, send to the team and
 * keep out of version control.
 */

export const FILE_EXTENSION = "sampo";
export const FORMAT_ID = "sampo-story";

/**
 * Bump when the shape of the saved story changes, and add a migration from the previous
 * version in `migrations.ts` so older files keep opening.
 */
export const CURRENT_VERSION = 4;
