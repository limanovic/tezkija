/**
 * Display-only fixes for the Uthmani text under the bundled KFGQPC Uthmanic
 * Hafs font (v0.09). The database keeps the text as Tanzil encodes it.
 *
 * U+06DF ARABIC SMALL HIGH ROUNDED ZERO marks a silent letter — the small
 * circle the mushaf prints over the alef of plural verbs (تَلْبِسُوا۟). The
 * font draws that codepoint as a large dotted circle, and draws the circle
 * the mushaf wants at U+06E0 instead. 2,240 ayahs carry the mark, so without
 * this every plural verb reads as a typo.
 */
const DISPLAY_SUBSTITUTIONS: [RegExp, string][] = [[/۟/g, '۠']];

/** Text as the font renders it correctly. Apply at render time, never store. */
export function displayArabic(text: string): string {
  return DISPLAY_SUBSTITUTIONS.reduce((s, [from, to]) => s.replace(from, to), text);
}
