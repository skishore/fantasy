import {assert, flatten} from '../lib/base';
import {LOG_FREQUENCIES} from './frequencies';
import {is_bindu, is_consonant, is_vowel} from './wx';

interface Syllable {bindu?: true, consonants: string[], vowel: string};

const cross = (xs: string[], ys: string[]): string[] =>
    flatten(xs.map((x) => ys.map((y) => x + y)));

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
}

const syllables = (wx: string): Syllable[] => {
  let i = 0;
  const result = [];
  while (i < wx.length) {
    const last_position = i;
    const syllable: Syllable = {consonants: [], vowel: 'a'};
    [i, syllable.consonants] = parse_consonants(wx, i);
    assert(i === wx.length || is_vowel(wx[i]), () => wx);
    if (is_vowel(wx[i])) syllable.vowel = wx[i++];
    if (is_bindu(wx[i])) syllable.bindu = !!wx[i++] || true;
    assert(i > last_position, () => `Invalid WX character: ${wx[i]} (${wx})`);
    assert(syllable.consonants.length > 0 || !!syllable.vowel, () => wx);
    result.push(syllable);
  }
  return result;
}

const split = (wx: string): string[] => {
  const pieces: string[] = [];
  syllables(wx).forEach((x, i) => {
    const vowel = x.consonants.length === 0;
    x.consonants.forEach((y) => pieces.push(y));
    if (i > 0 && vowel) pieces.push('yx');
    pieces.push(!vowel && x.vowel === 'a' ? 'ax' : x.vowel);
    if (x.bindu) pieces.push('nx');
  });
  const last = pieces[pieces.length - 1];
  if (last === 'ax') pieces[pieces.length - 1] = 'ay';
  if (last === 'nx') pieces[pieces.length - 1] = 'ny';
  if (last !== 'nx') pieces.push('zy');
  assert(pieces.every((x) => !!LOG_FREQUENCIES[x]));
  return pieces;
}

const viterbi = (latin: string, wx: string): number => {
  const row = latin.length + 1;
  const pieces = split(wx).map((x) => Object.entries(LOG_FREQUENCIES[x]));
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
}

/*
const transliterate = (word: string): string[] =>
    split(word).map((x) => TRANSLITERATIONS[x]).reduce(cross, ['']);
*/

export {split};

/*
declare const require: any;
const fs = require('fs');
const data: string = fs.readFileSync('datasets/wx.txt', 'utf-8');
for (const line of data.split('\n')) {
  const [count, wx] = line.split(' ');
  if (!line || !wx || is_bindu(wx[0])) continue;
  if (wx.replace(/M/g, 'z').includes('zz')) continue;
  if (Array.from('qHVY@_\xd9').some((x) => wx.includes(x))) continue;
  if (Array.from(wx).some((x) => '0' <= x && x <= '9')) continue;
  console.log(`${count} ${wx} -> ${split(wx).join(' ')}`);
}
*/
