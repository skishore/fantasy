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
