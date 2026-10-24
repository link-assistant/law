// Experiment: multiline quoted references in Links Notation.
// lino-objects-codec round-trips them; the indented-record form used by the
// registry and catalog is parsed here with links-notation to compare.
import { encode, decode } from 'lino-objects-codec';
import { Parser } from 'links-notation';

for (const value of ['a\nb', { t: 'line1\nline2' }]) {
  const notation = encode({ obj: value });
  console.log(
    'codec',
    JSON.stringify(notation),
    '→',
    JSON.stringify(decode({ notation }))
  );
}
const parser = new Parser();
for (const text of [
  "doc:\n  t 'line1\nline2'\n  u ok\n",
  "doc:\n  t 'one line'\n  u ok\n",
]) {
  try {
    const links = parser.parse(text);
    console.log(
      'parser',
      JSON.stringify(text),
      '→',
      JSON.stringify(links, (k, v) => (v === null ? undefined : v))
    );
  } catch (error) {
    console.log('parser', JSON.stringify(text), '→ ERR', error.message);
  }
}

// formatIndented / parseIndented: the indented record helpers.
const { formatIndented, parseIndented } = await import('lino-objects-codec');
for (const obj of [{ t: 'one line' }, { t: 'line1\nline2' }]) {
  const text = formatIndented({ id: 'doc', obj });
  try {
    console.log(
      'indented',
      JSON.stringify(text),
      '→',
      JSON.stringify(parseIndented({ text }))
    );
  } catch (error) {
    console.log('indented', JSON.stringify(text), '→ ERR', error.message);
  }
}
