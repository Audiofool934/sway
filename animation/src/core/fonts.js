// The film's three open-licensed typefaces (SIL OFL, see assets/fonts): Fraunces for
// headlines, DM Sans for captions, IBM Plex Mono for dates, labels, and numbers.

const FONT_DIR = new URL("../../assets/fonts/", import.meta.url);

const FACES = [
  ["Fraunces", "fraunces-latin-wght-normal.woff2", "100 900", "normal"],
  ["Fraunces", "fraunces-latin-wght-italic.woff2", "100 900", "italic"],
  ["DM Sans", "dm-sans-latin-wght-normal.woff2", "100 1000", "normal"],
  ["IBM Plex Mono", "ibm-plex-mono-latin-400-normal.woff2", "400", "normal"],
  ["IBM Plex Mono", "ibm-plex-mono-latin-500-normal.woff2", "500", "normal"],
  ["IBM Plex Mono", "ibm-plex-mono-latin-600-normal.woff2", "600", "normal"],
];

export const SERIF = '"Fraunces", Georgia, serif';
export const SANS = '"DM Sans", system-ui, sans-serif';
export const MONO = '"IBM Plex Mono", ui-monospace, monospace';

export async function loadFonts() {
  await Promise.all(
    FACES.map(async ([family, file, weight, style]) => {
      const face = new FontFace(
        family,
        `url(${new URL(file, FONT_DIR).href}) format("woff2")`,
        { weight, style },
      );
      document.fonts.add(await face.load());
    }),
  );
  await document.fonts.ready;
}
