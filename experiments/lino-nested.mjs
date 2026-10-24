// Experiment: nested records and lists inside an indented Links Notation file.
import { Parser } from 'links-notation';
const text = `us-code:
  jurisdiction US
  languages en es
  legal:
    status public-domain
    basis '17 U.S.C. § 105'
  documents:
    usc01:
      title 'Title 1'
    usc02:
      title "Title 2 'x'"
eu-cellar:
  jurisdiction EU
`;
const dump = (l, d = 0) => {
  console.log(
    ' '.repeat(d * 2) +
      JSON.stringify({ id: l.id ?? null, n: l.values?.length ?? 0 })
  );
  for (const v of l.values ?? []) {
    dump(v, d + 1);
  }
};
new Parser().parse(text).forEach((l) => dump(l));
