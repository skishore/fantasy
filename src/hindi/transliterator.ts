import {assert, flatten} from '../lib/base';
import {DAWG} from '../lib/dawg';
import {LOG_FREQUENCIES} from './frequencies';
import {is_bindu, is_consonant, is_vowel} from './wx';

// Prepare a set of "hash keys" that will allow us to match input Latin text
// with possible transliterations of a given WX-encoded Hindi word.

const disemvowel = (latin: string): string => latin.replace(/[aeiou]/gi, '');

const unique = <T>(xs: T[]): T[] => {
  let last: T | null = null;
  return xs
    .slice()
    .sort()
    .filter((x, i) => {
      if (i > 0 && x === last) return false;
      return !!(last = x) || true;
    });
};

const DROPPED_PIECES = ['ny', 'zy'];
const DROPPED_LATINS = unique(
  flatten(DROPPED_PIECES.map(x => Object.keys(LOG_FREQUENCIES[x]))),
);

const HASH_KEYS: {[wx: string]: string[]} = {};
Object.entries(LOG_FREQUENCIES).forEach(
  ([k, v]) => (HASH_KEYS[k] = unique(Object.keys(v).map(disemvowel))),
);
DROPPED_PIECES.forEach(x => (HASH_KEYS[x] = ['']));

const cross = (xs: string[], ys: string[]): string[] =>
  flatten(xs.map(x => ys.map(y => x + y)));

const error = (wx: string) => () => `Invalid WX: ${wx}`;

const hash_keys_from_latin = (latin: string): string[] => {
  let disemvowelled = disemvowel(latin);
  if (disemvowelled[0] !== latin[0]) disemvowelled = `*${disemvowelled}`;
  const n = disemvowelled.length;
  return DROPPED_LATINS.filter(x => disemvowelled.endsWith(x)).map(x =>
    disemvowelled.slice(0, n - x.length),
  );
};

const hash_keys_from_wx = (wx: string): string[] => {
  const pieces = split(wx);
  assert(pieces.length > 0, error(wx));
  const disemvowelled = pieces.map(x => HASH_KEYS[x]);
  if (disemvowel(pieces[0]).length === 0) {
    disemvowelled.unshift(['*']);
  }
  return disemvowelled.reduce(cross, ['']);
};

// The main transliteration logic follows.

interface Syllable {
  bindu?: true;
  consonants: string[];
  vowel: string;
}

const parse_consonants = (wx: string, i: number): [number, string[]] => {
  const consonants = [];
  while (is_consonant(wx[i])) {
    const ch = wx[i++];
    if (wx[i] === 'Z') {
      const nukta = `${ch}${wx[i++]}`;
      consonants.push(LOG_FREQUENCIES[nukta] ? nukta : ch);
    } else {
      consonants.push(ch);
    }
  }
  return [i, consonants];
};

const syllables = (wx: string): Syllable[] => {
  let i = 0;
  const result = [];
  while (i < wx.length) {
    const last_position = i;
    const syllable: Syllable = {consonants: [], vowel: 'a'};
    [i, syllable.consonants] = parse_consonants(wx, i);
    assert(i === wx.length || is_vowel(wx[i]), error(wx));
    if (is_vowel(wx[i])) syllable.vowel = wx[i++];
    if (is_bindu(wx[i])) syllable.bindu = !!wx[i++] || true;
    assert(i > last_position, () => `Invalid WX character: ${wx[i]} (${wx})`);
    assert(syllable.consonants.length > 0 || !!syllable.vowel, error(wx));
    result.push(syllable);
  }
  return result;
};

const split = (wx: string): string[] => {
  const pieces: string[] = [];
  syllables(wx).forEach((x, i) => {
    const vowel = x.consonants.length === 0;
    x.consonants.forEach(y => pieces.push(y));
    if (i > 0 && vowel) pieces.push('yx');
    pieces.push(!vowel && x.vowel === 'a' ? 'ax' : x.vowel);
    if (x.bindu) pieces.push('nx');
  });
  const last = pieces[pieces.length - 1];
  if (last === 'ax') pieces[pieces.length - 1] = 'ay';
  if (last === 'nx') pieces[pieces.length - 1] = 'ny';
  if (last !== 'nx') pieces.push('zy');
  assert(pieces.every(x => !!LOG_FREQUENCIES[x]), error(wx));
  return pieces;
};

const viterbi = (latin: string, wx: string): number => {
  const row = latin.length + 1;
  const pieces = split(wx).map(x => Object.entries(LOG_FREQUENCIES[x]));
  const memo: number[] = Array(row * (pieces.length + 1)).fill(-Infinity);
  memo[0] = 0;
  for (let i = 0; i < pieces.length; i++) {
    for (let j = 0; j <= latin.length; j++) {
      const head = i * row + j;
      if (memo[head] === -Infinity) continue;
      for (const [option, score] of pieces[i]) {
        if (latin.substring(j, j + option.length) !== option) continue;
        const tail = (i + 1) * row + j + option.length;
        memo[tail] = Math.max(memo[tail], memo[head] + score);
      }
    }
  }
  return memo[memo.length - 1];
};

// We wrap the transliteration logic in a simple interface.

class Transliterator {
  private dawg: DAWG<string, string>;
  constructor(words: string[]) {
    this.dawg = new DAWG();
    for (const wx of words) {
      for (const key of hash_keys_from_wx(wx)) {
        this.dawg.add(key, wx);
      }
    }
    this.dawg.compress();
  }
  transliterate(latin: string): string[] {
    latin = latin.toLowerCase();
    const pairs: [string, number][] = [];
    const visited: {[wx: string]: boolean} = {};
    for (const key of hash_keys_from_latin(latin)) {
      for (const wx of this.dawg.get(key)) {
        if (visited[wx]) continue;
        visited[wx] = true;
        pairs.push([wx, viterbi(latin, wx)]);
      }
    }
    return pairs.sort((x, y) => y[1] - x[1]).map(x => x[0]);
  }
}

export {Transliterator};
