import {Trie} from '../lib/trie';
import {SYMBOLS} from './devanagari';
import {transliterate} from './transliterator';

declare const require: any;
const fs = require('fs');

const items: {keys: string[], value: string}[] = [];
const data: string = fs.readFileSync('datasets/unicode.txt', 'utf-8');
const lines = data.split('\n').slice(0, 30967);
console.log(`Reading ${lines.length} words...`);
for (const line of lines) {
  const [str, wx, word] = line.split(' ');
  if (!word || word.startsWith('#')) continue;
  if (word.includes(SYMBOLS.visarga) ||
      word.startsWith(SYMBOLS.anusvara) ||
      word.startsWith(SYMBOLS.chandrabindu)) continue;
  const frequency = parseInt(str, 10);
  const transliterations = transliterate(word);
  transliterations.forEach(
      (x) => items.push({keys: Array.from(x), value: word}));
}

const matches: {[index: string]: string[]} = {};
const vocab: {[index: string]: boolean} = {};
for (const item of items) {
  const key = item.keys.join('');
  (matches[key] = matches[key] || []).push(item.value);
  vocab[item.value] = true;
}

console.log(`Building trie with ${items.length} items...`);
const trie = Trie.new(items);
const deduped = Trie.serialize(trie).length;
console.log(`Done! Compressed trie has ${deduped} distinct nodes.`);

console.log('');
const counts = {out_of_vocab: 0, match: 0, miss: 0, multiple: 0};
const pair_data: string = fs.readFileSync('combined.txt', 'utf-8');
const pairs = pair_data.split('\n').filter((x) => !!x && x[0] !== '/');
for (const pair of pairs) {
  const [latin, hindi] = pair.split('\t');
  const match = matches[latin] || [];
  if (!vocab[hindi]) {
    console.log(`Out of vocab: ${hindi}`);
    counts.out_of_vocab += 1;
  } else if (match.filter((x) => x === hindi).length === 0) {
    console.log(`Miss: ${hindi} -> ${latin} (${transliterate(hindi).join(', ')})`);
    counts.miss += 1;
  } else if (match.length > 1) {
    console.log(`Multiple: ${hindi} -> ${latin} (${match.join(', ')})`);
    counts.multiple += 1;
  } else {
    counts.match += 1;
  }
}

console.log('');
console.log('Counts:', counts);
console.log(`Precision: ${counts.match / (counts.match + counts.multiple)}`);
console.log(`Recall: ${(counts.match + counts.multiple) / (counts.match + counts.miss + counts.multiple)}`);
