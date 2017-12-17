import {assert, flatten} from '../lib/base';
import {Tense} from '../parsing/lexer';

interface Entry {
  head: string,
  latin: string,
  tenses?: Tense[],
  texts: Map<string, number>,
  types: Map<string, number>,
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

const map = (x: string) => new Map([[x, 0]]);

const rollup = (cases: Case[], type: string, value: any): Entry[] => {
  const head = cases[0].wx;
  const lookup: {[wx: string]: Entry} = {};
  const result: Entry[] = [];
  cases.forEach((x) => {
    let entry = lookup[x.wx];
    if (!entry) {
      result.push({...x, head, texts: new Map(), types: map(type), value});
      entry = lookup[x.wx] = result[result.length - 1];
      cases.forEach((y) => entry.texts.set(y.latin, -0.5));
    }
    x.tenses.forEach((y) => (entry.tenses || []).push(y));
    entry.texts.set(x.latin, 0);
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
  tenses = tenses.map((x) => x.slice());
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
  const entries = rollup(zip(latins, tenses, wxs), 'noun', value);
  for (let i = 0; i < 2; i++) {
    const subcases = cases.slice(2*i, 2*i + 2);
    rollup(subcases, 'noun', value).forEach((x) => {
      x.types = new Map();
      subcases.forEach((y) => {
        const type = `noun_${y.tenses[0].case}_${y.tenses[0].number}`;
        x.types.set(type, x.wx === y.wx ? 0 : -0.5);
      });
      entries.push(x);
    });
  }
  return entries;
}

const number = (spec: string): Entry[] => {
  const [latins, wxs] = split(spec);
  return flatten(latins.map((x, i) => {
    const tenses = [{number: i === 1 ? 'singular' : 'plural'}];
    return rollup([{latin: x, tenses, wx: wxs[i]}], 'number', i);
  }));
}

const particle = (value: string, spec: string,
                  type: string, tenses?: Tense[]): Entry[] => {
  const [latin, wx] = split(spec).map((x) => x[0]);
  const [texts, types] = [map(latin), map(type)];
  return [{head: wx, latin, tenses, texts, types, value, wx}];
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
