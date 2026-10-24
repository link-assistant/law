// Experiment: toLino/fromLino round trip.
import { toLino, fromLino } from '../src/law/lino.js';
const obj = {
  s: {
    jurisdiction: 'US',
    languages: ['en'],
    title: 'It\'s "q"',
    legal: { status: 'public-domain', mirror: true },
    docs: [{ a: '1' }, { a: 'x y' }],
  },
};
const text = toLino(obj);
console.log(text);
console.log(JSON.stringify(fromLino(text, { listKeys: ['languages'] })));
