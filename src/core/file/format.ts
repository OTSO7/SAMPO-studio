/**
 * The story inside a `.sampo` file: a UTF-8 JSON document.
 *
 * The file itself is a package (written by the desktop side) holding this document and the
 * pictures and sounds it points at, so a story is one file that is trivial to back up and
 * take to another computer. JSON rather than a binary format so a damaged story can still be
 * opened and repaired by hand.
 */

export const FILE_EXTENSION = "sampo";
export const FORMAT_ID = "sampo-story";

/**
 * Bump when the shape of the saved story changes, and add a migration from the previous
 * version in `migrations.ts` so older files keep opening.
 */
export const CURRENT_VERSION = 7;
