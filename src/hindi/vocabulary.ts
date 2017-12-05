import {assert, flatten} from '../lib/base';
import {Tense} from '../parsing/lexer';

interface Entry {
  head: string,
  latin: string,
  tenses?: Tense[],
  type: string,
  value: any,
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
  {number: 'plural', person: 'second', tone: 'formal'},
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

const rollup = (cases: Case[], type: string, value: any): Entry[] => {
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
  const cases = zip(latins, tenses, wxs);
  const entries = cases.map((x) => flatten(x.tenses.map((y) =>
      rollup([{...x, tenses: [y]}], `noun_${y.case}_${y.number}`, value))));
  entries.push(rollup(zip(latins, tenses, wxs), 'noun', value));
  // TODO(skishore): These two lines that replace the head values of the
  // noun subcategories are a dirty hack to support correction for them.
  const head = entries[entries.length - 1][0].head;
  return flatten(entries).map((x) => { x.head = head; return x; });
}

const number = (spec: string): Entry[] => {
  const [latins, wxs] = split(spec);
  return flatten(latins.map((x, i) => {
    const tenses = [{number: i === 1 ? 'singular' : 'plural'}];
    return rollup([{latin: x, tenses, wx: wxs[i]}], 'number', i);
  }));
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

const Vocabulary = {adjective, copula, noun, number, particle, pronoun, verb};

export {Entry, Vocabulary};
