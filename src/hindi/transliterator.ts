import {assert} from '../lib/base';
import {NUKTAS, SYMBOLS, TRANSLITERATIONS, VOWELS, VOWEL_SIGNS} from './devanagari';

interface Syllable {bindu?: true, consonants: string[], vowel?: string};

const align = (hindi: string, latin: string): [string, string][] | null => {
  const pieces = split(hindi);
  const memo: ([number, [string, string]] | null)[] =
      Array((latin.length + 1) * (pieces.length + 1)).fill(null);
  for (let i = 0; i < pieces.length; i++) {
    for (let j = 0; j <= latin.length; j++) {
      const head = i * (latin.length + 1) + j;
      if (!memo[head] && (i || j)) continue;
      for (const option of TRANSLITERATIONS[pieces[i]]) {
        if (latin.substring(j, j + option.length) !== option) continue;
        const tail = (i + 1) * (latin.length + 1) + j + option.length;
        memo[tail] = [head, [pieces[i], option]];
      }
    }
  }
  let current = memo[memo.length - 1];
  const result: [string, string][] = [];
  while (current) {
    result.push(current[1]);
    current = memo[current[0]];
  }
  return result.length < pieces.length ? null : result.reverse();
}

const bindu = (ch: string): boolean =>
    ch === SYMBOLS.anusvara || ch === SYMBOLS.chandrabindu;

const consonant = (ch: string): boolean => {
  const code = ch.charCodeAt(0);
  return ('क'.charCodeAt(0) <= code && code <= 'ह'.charCodeAt(0)) ||
         ('क़'.charCodeAt(0) <= code && code <= 'य़'.charCodeAt(0));
}

const cross = (xs: string[], ys: string[]): string[] =>
    [].concat.apply([], xs.map((x) => ys.map((y) => x + y)));

const parse_consonants = (word: string, i: number): [number, string[]] => {
  const result = [];
  while (i < word.length) {
    const item = word[i++];
    assert(consonant(item), () => word);
    result.push((word[i] === SYMBOLS.nukta ? NUKTAS[item] : null) || item);
    if (word[i] === SYMBOLS.nukta) i += 1;
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

const split = (word: string): string[] => {
  const pieces: string[] = [];
  syllables(word).forEach((x, i) => {
    x.consonants.forEach((y) => pieces.push(y));
    if (i > 0 && x.consonants.length === 0) pieces.push('y');
    pieces.push(x.vowel || 'a');
    if (x.bindu) pieces.push('n');
  });
  assert(pieces.every((x) => !!TRANSLITERATIONS[x]));
  return pieces;
}

const transliterate = (word: string): string[] =>
    split(word).map((x) => TRANSLITERATIONS[x]).reduce(cross, ['']);

export {align, split, transliterate};
