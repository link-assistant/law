// Experiment: how links-notation parses an indented registry record.
import { Parser } from 'links-notation';
import { encode, decode } from 'lino-objects-codec';

const text = `us-code:
  jurisdiction US
  title 'United States Code'
  mode mirror
  basis '17 U.S.C. § 105'
  url 'https://uscode.house.gov/download/download.shtml'
  languages
    en
`;
const links = new Parser().parse(text);
const dump = (l, d = 0) => {
  console.log(
    ' '.repeat(d * 2) +
      JSON.stringify({ id: l.id ?? null, n: l.values?.length ?? 0 })
  );
  for (const v of l.values ?? []) {
    dump(v, d + 1);
  }
};
links.forEach((l) => dump(l));
console.log(String(links[0]));
console.log(encode({ obj: { a: 'x y', b: ['en', 'fr'], c: { d: 1 } } }));
console.log(
  JSON.stringify(decode({ notation: encode({ obj: { a: 'line1\nline2' } }) }))
);
