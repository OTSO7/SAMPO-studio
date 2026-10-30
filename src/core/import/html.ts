/**
 * Word processors put the document's real structure on the clipboard as HTML; the plain text
 * beside it has lost it. This turns that HTML into lines `suggestRows` understands: `#` headings,
 * `•` list items, and one line per table row. `null` when the HTML shows no headings, so the
 * plain text is just as good.
 */

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
const NOT_CONTENT = /<!--[\s\S]*?-->|<(style|script|head|title)\b[\s\S]*?<\/\1\s*>/giu;
const TOKEN = /<(\/?)([a-z][a-z0-9]*)\b([^>]*)>|([^<]+)/giu;
const MAX_HEADING_LENGTH = 90;

function decode(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/giu, (whole, code: string) => {
    if (!code.startsWith("#")) return ENTITIES[code.toLowerCase()] ?? whole;
    const hex = code[1]?.toLowerCase() === "x";
    const value = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
    return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : whole;
  });
}

function styleOf(tag: string, attributes: string, parent: { bold: boolean; size: number }) {
  const weight = /font-weight:\s*([a-z0-9]+)/iu.exec(attributes)?.[1]?.toLowerCase();
  const size = /font-size:\s*([\d.]+)pt/iu.exec(attributes)?.[1];
  const bold =
    weight === undefined
      ? parent.bold || tag === "b" || tag === "strong"
      : weight === "bold" || Number(weight) >= 600;
  return { bold, size: size === undefined ? parent.size : Number(size) };
}

/** Many documents make headings by hand: a short line that is all bold or set larger. */
function drawnHeadingLevel(text: string, allBold: boolean, size: number): number | null {
  if (text.length > MAX_HEADING_LENGTH || /[.!?;,]$/u.test(text)) return null;
  if (size >= 18) return 1;
  if (size >= 14) return 2;
  return allBold ? 3 : null;
}

export function htmlToOutline(html: string): string | null {
  const lines: string[] = [];
  const styles = [{ bold: false, size: 0 }];
  let text = "";
  let allBold = true;
  let size = 0;
  let level: number | null = null;
  let listDepth = 0;
  let row: string[] | null = null;
  let cell: string | null = null;

  const endBlock = () => {
    const line = decode(text).replace(/\s+/gu, " ").trim();
    if (line !== "") {
      const heading = level ?? (listDepth > 0 ? null : drawnHeadingLevel(line, allBold, size));
      if (heading !== null) lines.push(`${"#".repeat(heading)} ${line}`);
      else lines.push(listDepth > 0 ? `• ${line}` : line);
    }
    text = "";
    allBold = true;
    size = 0;
    level = null;
  };

  for (const match of html.replace(NOT_CONTENT, "").matchAll(TOKEN)) {
    const [, closing, rawTag, attributes = "", content] = match;
    if (content !== undefined) {
      if (cell !== null) {
        cell += content;
      } else if (content.trim() !== "") {
        const style = styles.at(-1) ?? { bold: false, size: 0 };
        text += content;
        allBold &&= style.bold;
        size = Math.max(size, style.size);
      } else {
        text += content;
      }
      continue;
    }
    const tag = (rawTag ?? "").toLowerCase();
    const opening = closing === "";

    if (["span", "b", "strong", "font"].includes(tag)) {
      if (opening) styles.push(styleOf(tag, attributes, styles.at(-1) ?? { bold: false, size: 0 }));
      else if (styles.length > 1) styles.pop();
    } else if (tag === "tr") {
      if (opening) {
        endBlock();
        row = [];
      } else if (row !== null) {
        const cells = row.filter((value) => value !== "");
        if (cells.length > 0) lines.push(cells.join(" — "));
        row = null;
      }
    } else if (tag === "td" || tag === "th") {
      if (opening) {
        cell = "";
      } else if (cell !== null) {
        row?.push(decode(cell).replace(/\s+/gu, " ").trim());
        cell = null;
      }
    } else if (cell !== null) {
      // Paragraphs and line breaks inside a table cell only separate words.
      if (["p", "br", "div", "li"].includes(tag)) cell += " ";
    } else if (/^h[1-6]$/u.test(tag)) {
      endBlock();
      if (opening) level = Number(tag.charAt(1));
    } else if (tag === "li") {
      endBlock();
      listDepth = Math.max(0, listDepth + (opening ? 1 : -1));
    } else if (["p", "div", "br", "ul", "ol", "table", "blockquote"].includes(tag)) {
      endBlock();
    }
  }
  endBlock();

  return lines.some((line) => line.startsWith("#")) ? lines.join("\n") : null;
}
