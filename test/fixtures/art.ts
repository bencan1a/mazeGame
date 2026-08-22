/**
 * Shared ASCII-art parsing for the fixture builders.
 *
 * Fixtures are read far more often than they are written — six streams read
 * each other's test failures — so the specs are pictures, and the picture is
 * the single source of truth for the fixture it describes.
 *
 * Canonical form is what `render*` emits: no indentation, rows joined by '\n',
 * no trailing newline. Parsing accepts more than that (indented template
 * literals, leading and trailing blank lines) so that a spec written inline in
 * a test still reads as a picture at the indentation of its call site.
 */

/**
 * Split art into rows, stripping the blank lines and common indentation that
 * an inline template literal picks up from its surroundings.
 *
 * Throws on ragged art: rows of unequal length are always a typo, and finding
 * one here is much cheaper than finding it as an off-by-one three stages later.
 */
export function toRows(art: string): string[] {
  const lines = art.split('\n');
  while (lines.length > 0 && (lines[0] as string).trim() === '') lines.shift();
  while (lines.length > 0 && (lines[lines.length - 1] as string).trim() === '') lines.pop();
  if (lines.length === 0) throw new Error('ascii art is empty');

  const indent = Math.min(...lines.map((line) => line.length - line.trimStart().length));
  const rows = lines.map((line) => line.slice(indent).trimEnd());

  const width = (rows[0] as string).length;
  if (width === 0) throw new Error('ascii art has a zero-width row');
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y] as string;
    if (row.length !== width) {
      throw new Error(
        `ascii art is ragged: row 0 is ${width} wide, row ${y} is ${row.length} wide`,
      );
    }
  }
  return rows;
}

/** Join rows back into canonical form. The inverse of `toRows` on canonical input. */
export function fromRows(rows: readonly string[]): string {
  return rows.join('\n');
}
