import {assert} from '../lib/base';
import {SYMBOLS, TRANSLITERATIONS, VOWELS, VOWEL_SIGNS} from './devanagari';

const bindu = (ch: string): boolean =>
    ch === SYMBOLS.anusvara || ch === SYMBOLS.chandrabindu;

const consonant = (ch: string): boolean => {
  const code = ch.charCodeAt(0);
  return ('क'.charCodeAt(0) <= code && code <= 'ह'.charCodeAt(0)) ||
         ('क़'.charCodeAt(0) <= code && code <= 'य़'.charCodeAt(0));
}

const cross = (xs: string[], ys: string[]): string[] =>
    [].concat.apply([], xs.map((x) => ys.map((y) => x + y)));

const normalize = (ch: string): string => VOWEL_SIGNS[ch] || ch;

const transliterate = (word: string): string[] => {
  const result: string[][] = [];
  const characters = Array.from(word).map(normalize);
  let last_was_consonant = false;
  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i];
    const transliteration = TRANSLITERATIONS[ch];
    assert(transliteration != null, () => `Invalid Devanagari: ${ch}`);
    if (last_was_consonant && bindu(ch)) {
      result.push(['a']);
    } else if (last_was_consonant && consonant(ch)) {
      result.push(['a', '']);
    }
    last_was_consonant = consonant(ch);
    result.push(transliteration);
  }
  if (last_was_consonant) {
    result.push(['a', '']);
  }
  return result.reduce(cross, ['']);
}

export {transliterate};
