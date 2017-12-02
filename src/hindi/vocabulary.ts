import {assert, flatten} from '../lib/base';
import {Tense} from '../parsing/lexer';

interface Entry {
  head: string,
  latin: string,
  tenses?: Tense[],
  type: string,
  value: string,
  wx: string,
}

// Boilerplate helpers needed to support the core declension routines.

interface Case {latin: string, tenses: Tense[], wx: string}

type Gender = 'feminine' | 'masculine';

const kNounTenses: Tense[] = [
  {case: 'direct', number: 'singular'},
  {case: 'oblique', number: 'singular'},
  {case: 'direct', number: 'plural'},
  {case: 'oblique', number: 'plural'},
];

const kPronounTenses: Tense[] = [
  {number: 'singular', person: 'first'},
  {number: 'singular', person: 'second', tone: 'intimate'},
  {number: 'singular', person: 'third'},
  {number: 'plural', person: 'first'},
  {number: 'plural', person: 'second', tone: 'casual'},
  {number: 'plural', person: 'second', tone: 'casual'},
  {number: 'plural', person: 'third'},
];

const kVerbTenses: Tense[] = [
  {gender: 'masculine', number: 'singular'},
  {gender: 'masculine', number: 'plural'},
  {gender: 'feminine'},
];

const kFeminine = {gender: 'feminine'};
const kMasculine = {gender: 'masculine'};

const kFeminineTenses = kNounTenses.map((x) => [{...x, ...kFeminine}]);
const kMasculineTenses = kNounTenses.map((x) => [{...x, ...kMasculine}]);

const kPronounSemantics: Tense = {first: 'i', second: 'you', third: 'they'};

const rollup = (cases: Case[], type: string, value: string): Entry[] => {
  const lookup: {[wx: string]: Entry} = {};
  const result: Entry[] = [];
  cases.forEach((x) => {
    const entry = lookup[x.wx];
    if (!entry) {
      result.push({...x, head: cases[0].wx, type, value});
      lookup[x.wx] = result[result.length - 1];
    } else {
      assert(entry.latin === x.latin, () => `Ambiguous Latin for: ${x.wx}`);
      x.tenses.forEach((x) => (entry.tenses || []).push(x));
    }
  });
  return result;
}

const split = (spec: string): [string[], string[]] => {
  let last: string = '';
  const parts = spec.split(' ');
  assert(parts.length > 0 && parts[0] !== '.', () => `Invalid spec: ${spec}`);
  const pairs = parts.map((x) => (x === '.' ? last : (last = x)).split('/'));
  assert(pairs.every((x) => x.length === 2), () => `Invalid spec: ${spec}`);
  return [pairs.map((x) => x[0]), pairs.map((x) => x[1])];
}

const zip = (latins: string[], tenses: Tense[][], wxs: string[]): Case[] => {
  assert(latins.length === tenses.length && tenses.length === wxs.length,
         () => `Invalid cases: ${latins.join(' ')}`);
  return latins.map((x, i) => ({latin: x, tenses: tenses[i], wx: wxs[i]}));
}

// Helpers for generating declined adjectives, nouns, and verbs.

const adjective = (value: string, spec: string): Entry[] => {
  const [latin, wx] = split(spec).map((x) => x[0]);
  const tenses: Tense[][] = [[0], [1, 2, 3]].map(
      (x) => x.map((y) => kMasculineTenses[y][0]));
  tenses.push([kFeminine]);
  if (latin.endsWith('a') && wx.endsWith('A')) {
    const latins = ['a', 'e', 'i'].map((x) => `${latin.slice(0, -1)}${x}`);
    const wxs = ['A', 'e', 'I'].map((x) => `${wx.slice(0, -1)}${x}`);
    return rollup(zip(latins, tenses, wxs), 'adjective', value);
  } else {
    return rollup([{latin, tenses: [], wx}], 'adjective', value);
  }
}

const copula = (spec: string): Entry[] => {
  const [latins, wxs] = split(spec);
  const tenses = kPronounTenses.map((x) => [x]);
  return rollup(zip(latins, tenses, wxs), 'copula', 'be');
}

const noun = (value: string, spec: string, gender: Gender): Entry[] => {
  const [latins, wxs] = split(spec);
  const tenses = gender === 'feminine' ? kFeminineTenses : kMasculineTenses;
  return rollup(zip(latins, tenses, wxs), 'noun', value);
}

const particle = (value: string, spec: string, type: string): Entry[] => {
  const [latin, wx] = split(spec).map((x) => x[0]);
  return [{head: wx, latin, type, value, wx}];
}

const pronoun = (spec: string): Entry[] => {
  const [latins, wxs] = split(spec);
  const tenses = kPronounTenses.map((x) => [x]);
  const entries = rollup(zip(latins, tenses, wxs), 'pronoun', '');
  entries.forEach((x) => x.value = kPronounSemantics[x.tenses![0].person]);
  assert(entries.every((x) => !!x.value));
  return entries;
}

const verb = (value: string, spec: string): Entry[] => {
  const [latin, wx] = split(spec).map((x) => x[0]);
  assert(latin.endsWith('na') && wx.endsWith('nA'),
         () => `Invalid infinitive: ${latin}`);
  const latins = ['tha', 'the', 'thi'].map((x) => `${latin.slice(0, -2)}${x}`);
  const wxs = ['wA', 'we', 'wI'].map((x) => `${wx.slice(0, -2)}${x}`);
  const tenses = kVerbTenses.map((x) => [x]);
  return rollup(zip(latins, tenses, wxs), 'verb', value);
}

const Vocabulary = {adjective, copula, noun, particle, verb};

export {Entry, Vocabulary};

// A basic test of the Hindi declension logic.
import {debug} from '../lib/base';
import {wx_to_hindi} from './wx';
const vocabulary = flatten([
  adjective('bad', 'kharab/KarAb'),
  adjective('large', 'bara/baDZA'),
  copula('hoon/hUz hai/hE . hain/hEM ho/ho hain/hEM .'),
  noun('apple', 'seb/seb . . sebo/seboM', 'masculine'),
  noun('boy', 'larka/ladZakA larke/ladZake . larko/ladZakoM', 'masculine'),
  particle('this', 'yeh/yah', 'determiner'),
  particle('that', 'voh/vah', 'determiner'),
  pronoun('main/mEM tu/wU voh/vah hum/ham tum/wum aap/Ap voh/vah'),
  verb('eat', 'khana/KAnA'),
  verb('sleep', 'sona/sonA'),
]);
vocabulary.forEach((x) => {
  const hindi = wx_to_hindi(x.wx);
  console.log(debug({hindi, latin: x.latin, type: x.type, value: x.value}));
});
