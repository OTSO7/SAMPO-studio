import { describe, expect, it } from "vitest";

import { htmlToOutline } from "./html";

/** As Google Docs copies it: all inside a non-bold <b>, styles on every span. */
const docs = (body: string) =>
  `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1">${body}</b>`;
const span = (text: string, style = "font-size:11pt;font-weight:400") =>
  `<span style="${style}">${text}</span>`;

describe("reading a word processor's clipboard", () => {
  it("keeps heading levels, paragraphs, lists and table rows", () => {
    const html = docs(
      `<h1 dir="ltr">${span("Hahmot", "font-size:20pt")}</h1>
       <p dir="ltr">${span("Aatos &amp; Elias, veljekset.")}</p>
       <h2>${span("Aatos Kaski (38)", "font-size:16pt")}</h2>
       <ul><li><p>${span("Hiljainen")}</p></li><li>${span("Tarkka")}</li></ul>
       <div><table><tbody>
         <tr><td><p>${span("Mitä näkee")}</p></td><td><p>${span("Totuus")}</p></td></tr>
         <tr><td><p>${span("ValKom")}</p></td><td><p>${span("Posti-")}</p><p>${span("laitos")}</p></td></tr>
       </tbody></table></div>`,
    );
    expect(htmlToOutline(html)?.split("\n")).toEqual([
      "# Hahmot",
      "Aatos & Elias, veljekset.",
      "## Aatos Kaski (38)",
      "• Hiljainen",
      "• Tarkka",
      "Mitä näkee — Totuus",
      "ValKom — Posti- laitos",
    ]);
  });

  it("recognises headings made by hand with bold or a larger size", () => {
    const html = docs(
      `<p>${span("Iso otsikko", "font-size:20pt;font-weight:400")}</p>
       <p>${span("Pieni otsikko", "font-size:11pt;font-weight:700")}</p>
       <p>${span("Tavallinen teksti, jossa ")}${span("yksi sana", "font-weight:700")}${span(" on lihavoitu.")}</p>
       <p>${span("Kokonaan lihavoitu lause.", "font-weight:700")}</p>`,
    );
    expect(htmlToOutline(html)?.split("\n")).toEqual([
      "# Iso otsikko",
      "### Pieni otsikko",
      "Tavallinen teksti, jossa yksi sana on lihavoitu.",
      "Kokonaan lihavoitu lause.",
    ]);
  });

  it("leaves the plain text to be used when the HTML has no headings", () => {
    expect(htmlToOutline(docs(`<p>${span("Vain tekstiä.")}</p>`))).toBeNull();
    expect(htmlToOutline("")).toBeNull();
  });

  it("ignores styles and scripts in the clipboard", () => {
    const html =
      "<style>h1{color:red}</style><script>x()</script><h1>Otsikko</h1><!-- <h2>Ei</h2> -->";
    expect(htmlToOutline(html)).toBe("# Otsikko");
  });
});
