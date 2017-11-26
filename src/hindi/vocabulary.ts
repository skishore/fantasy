import {assert, flatten} from '../lib/base';
import {Tense} from '../parsing/lexer';

interface Entry {
  head: string,
  tenses?: Tense[],
  type: string,
  value: string,
  wx: string,
}

type Gender = 'feminine' | 'masculine';

// Boilerplate helpers needed to support the core declension routines.

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

const rollup = (cases: Tense[][], texts: string[],
                type: string, value: string): Entry[] => {
  const result: Entry[] = [];
  if (texts.length !== cases.length) {
    const [x, y, z] = [cases.length, texts.length, texts.join(', ')];
    assert(false, () => `Expected ${x} ${type} cases; got ${y}: ${z}`);
  }
  const head = texts[0];
  const lookup: {[text: string]: Entry} = {};
  let text = head;
  assert(!!head && head !== '.', () => `Invalid ${type} head word: ${head}`);
  texts.forEach((x, i) => {
    const tenses = cases[i];
    text = x === '.' ? text : x;
    if (!lookup[text]) {
      result.push({head, type, value, wx: x});
      lookup[text] = result[result.length - 1];
    }
    if (tenses.length > 0) {
      const target = (lookup[text].tenses = lookup[text].tenses || []);
      tenses.forEach((x) => target.push(x));
    }
  });
  return result;
}

// Helpers for generating declined adjectives, nouns, and verbs.

const adjective = (value: string, text: string): Entry[] => {
  const tenses: Tense[][] = [[0], [1, 2, 3]].map(
      (x) => x.map((y) => kMasculineTenses[y][0]));
  tenses.push([kFeminine]);
  if (text.endsWith('A')) {
    const root = text.slice(0, -1);
    return rollup(tenses, [text, `${root}e`, `${root}I`], 'adjective', value);
  } else {
    return rollup([[]], [text], 'adjective', value);
  }
}

const copula = (text: string): Entry[] => {
  const tenses = kPronounTenses.map((x) => [x]);
  return rollup(tenses, text.split(' '), 'copula', 'be');
}

const noun = (value: string, text: string, gender: Gender): Entry[] => {
  const tenses = gender === 'feminine' ? kFeminineTenses : kMasculineTenses;
  return rollup(tenses, text.split(' '), 'noun', value);
}

const particle = (value: string, text: string, type: string): Entry[] => {
  return [{head: text, type, value, wx: text}];
}

const pronoun = (text: string): Entry[] => {
  const tenses = kPronounTenses.map((x) => [x]);
  const entries = rollup(tenses, text.split(' '), 'pronoun', '');
  entries.forEach((x) => x.value = kPronounSemantics[x.tenses![0].person]);
  assert(entries.every((x) => !!x.value));
  return entries;
}

const verb = (value: string, text: string): Entry[] => {
  assert(text.endsWith('nA'), () => `Invalid infinitive: ${text}`);
  const root = text.slice(0, -2);
  const tenses = kVerbTenses.map((x) => [x]);
  const texts = [`${root}wA`, `${root}we`, `${root}wI`];
  return rollup(tenses, texts, 'verb', value);
}

export {adjective, noun};

// A basic test of the Hindi declension logic.
import {debug} from '../lib/base';
import {wx_to_hindi} from './wx';
const vocabulary = flatten([
  adjective('bad', 'KarAb'),
  adjective('large', 'baDZA'),
  copula('hUz hE . hEM ho hEM .'),
  noun('apple', 'seb . . seboM', 'masculine'),
  noun('boy', 'ladZakA ladZake . ladZakoM', 'masculine'),
  particle('this', 'yah', 'determiner'),
  particle('that', 'vah', 'determiner'),
  pronoun('mEM wU vah ham wum Ap vah'),
  verb('eat', 'KAnA'),
  verb('sleep', 'sonA'),
]);
vocabulary.forEach((x) => {
  const head = wx_to_hindi(x.head);
  const hindi = wx_to_hindi(x.wx);
  console.log(debug({head, hindi, type: x.type, value: x.value}));
});
