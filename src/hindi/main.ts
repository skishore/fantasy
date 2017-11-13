import {Trie} from '../lib/trie';
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
  const frequency = parseInt(str, 10);
  const transliterations = transliterate(word);
  transliterations.forEach(
      (x) => items.push({keys: Array.from(x), value: word}));
}

console.log(`Building trie with ${items.length} items...`);
const trie = Trie.new(items);
const deduped = Trie.serialize(trie).length;
console.log(`Done! Compressed trie has ${deduped} distinct nodes.`);
