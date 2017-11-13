import {Trie} from '../lib/trie';
import {transliterate} from './transliterator';

declare const require: any;
const fs = require('fs');

const data: string = fs.readFileSync('datasets/unicode.txt', 'utf-8');
for (const line of data.split('\n').slice(0, 10)) {
  const [str, wx, word] = line.split(' ');
  if (!word || word.startsWith('#')) continue;
  const frequency = parseInt(str, 10);
  console.log(`${word} -> ${transliterate(word)}`);
}
