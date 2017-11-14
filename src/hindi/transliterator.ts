import {assert} from '../lib/base';
import {SYMBOLS, TRANSLITERATIONS, VOWELS, VOWEL_SIGNS} from './devanagari';

interface Syllable {bindu?: true, consonants: string[], vowel?: string};

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

const parse_consonants = (word: string, i: number): [number, string[]] => {
  const result = [];
  while (true) {
    assert(consonant(word[i]));
    result.push(word[i++]);
    if (word[i] !== SYMBOLS.virama) break;
    i += 1;
  }
  return [i, result];
}

const syllables = (word: string): Syllable[] => {
  let i = 0;
  const result = [];
  while (i < word.length) {
    const last_position = i;
    const syllable: Syllable = {consonants: []};
    if (consonant(word[i])) {
      [i, syllable.consonants] = parse_consonants(word, i);
    }
    const vowel = word[i];
    if (VOWELS.hasOwnProperty(vowel) || !!VOWEL_SIGNS[vowel]) {
      const half = !!VOWEL_SIGNS[vowel];
      assert(!(half && syllable.consonants.length === 0));
      if (!half && syllable.consonants.length > 0) {
        result.push(syllable);
        continue;
      }
      [i, syllable.vowel] = [i + 1, VOWEL_SIGNS[vowel] || vowel];
    }
    if (bindu(word[i])) {
      [i, syllable.bindu] = [i + 1, true];
    }
    assert(i > last_position, () => `Devanagari error: ${word[i]} (${word})`);
    assert(syllable.consonants.length > 0 || !!syllable.vowel, () => word);
    result.push(syllable);
  }
  return result;
}

const transliterate = (word: string): string[] => {
  const pieces: string[] = [];
  syllables(word).forEach((x, i) => {
    x.consonants.forEach((y) => pieces.push(y));
    if (i > 0 && x.consonants.length === 0) pieces.push('y');
    pieces.push(x.vowel || 'a');
    if (x.bindu) pieces.push('n');
  });
  const result = pieces.map((x) => TRANSLITERATIONS[x]);
  assert(result.every((x) => !!x));
  return result.reduce(cross, ['']);
}

export {transliterate};

const words = `
वैशाली
स्तूप
गणतांत्रिक
दिखते
रूपए
शासकीय
उन्नति
साम्राज्य
प्रमुख
अशोक
हमीं
अभी
चाहिए
की
पर
एक
क
कक
हैं
अ
गए
`.trim().split('\n').sort();

for (const word of words) {
  if (word !== words[0]) console.log('');
  console.log(`Syllables: ${word}`);
  console.log(syllables(word));
  console.log(`Transliterations: ${transliterate(word).join(', ')}`);
}
