import {assert} from '../lib/base';
import {SYMBOLS, TRANSLITERATIONS, VOWELS, VOWEL_SIGNS} from './devanagari';

const consonant = (ch: string): boolean => {
  const code = ch.charCodeAt(0);
  return ('क'.charCodeAt(0) <= code && code <= 'ह'.charCodeAt(0)) ||
         ('क़'.charCodeAt(0) <= code && code <= 'य़'.charCodeAt(0));
}

const normalize = (ch: string): string => {
  return VOWEL_SIGNS[ch] || ch;
}

const transliterate = (word: string): string => {
  const result = [];
  const characters = Array.from(word).map(normalize);
  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i];
    const transliteration = ch === ' ' ? ' ' : TRANSLITERATIONS[ch];
    assert(transliteration != null, () => `Invalid Devanagari: ${ch}`);
    result.push(transliteration);
    const next = characters[i + 1];
    if (!!next && consonant(ch) && consonant(next)) {
      result.push('a');
    }
  }
  return result.join('');
}

export {transliterate};

declare const require: any;
const fs = require('fs');
const readline = require('readline');

const stream = fs.createReadStream('/Users/skishore/Projects/Examples/english-hindi-dictionary/English-Hindi Dictionary.csv');
const reader = readline.createInterface({input: stream});

const read_word = (line: string): string | null => {
  try {
    return JSON.parse(`[${line}]`)[1].trim();
  } catch {
    return null;
  }
}

reader.on('line', (line: string) => {
  const word = read_word(line);
  if (!word || word === 'hword') return;
  console.log(word);
  console.log(`${word} -> ${transliterate(word)}`);
});
