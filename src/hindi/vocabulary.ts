import {assert, flatten} from '../lib/base';

interface Entry {
  hindi: string;
  latin: string;
  stem: string;
  tenses: Tense[];
  texts: Map<string, number>;
  types: Map<string, number>;
  value: Value;
}

type Tense = {[tense: string]: string};
type Value = number | string;

// Boilerplate helpers needed to support the core declension routines.

interface Case {
  hindi: string;
  latin: string;
  tense: Tense;
}

const kFeminine: Tense = {gender: 'feminine'};
const kMasculine: Tense = {gender: 'masculine'};

const kPlural: Tense = {number: 'plural'};
const kSingular: Tense = {number: 'singular'};

const kVerbTenses = [
  {...kMasculine, ...kSingular},
  {...kMasculine, ...kPlural},
  {...kFeminine},
];

const option = <T>(x: string, table: {[x: string]: T}, type: string): T => {
  if (x in table) return table[x];
  const keys = Object.keys(table)
    .map(x => JSON.stringify(x))
    .join(', ');
  throw new Error(`${type} must be in {${keys}}; got: ${x}`);
};

const rollup = (cases: Case[], type: string, value: Value): Entry[] => {
  // Collect the set of distinct words and a base entry common to them all.
  assert(cases.length > 0, () => `Invalid cases for type: ${type}`);
  const stem = `${type}-${cases[0].hindi}`;
  const base = () => ({stem, types: new Map([[type, 0]]), value});
  const hindis = Array.from(new Set(cases.map(x => x.hindi)).keys());

  // Return one entry for each distinct Hindi word.
  return hindis.map(hindi => {
    const local = cases.filter(x => x.hindi === hindi);
    const tenses = local.map(x => x.tense);
    const texts = new Map(
      cases.map(y => <[string, number]>[y.latin, y.hindi === hindi ? 0 : -1]),
    );
    return {...base(), hindi, latin: local[0].latin, tenses, texts};
  });
};

const split = (x: string): {hindi: string; latin: string} => {
  const result = x.split('/');
  if (result.length !== 2) throw Error(`Invalid word: ${x}`);
  return {hindi: result[1], latin: result[0]};
};

const zip = (hindis: string[], latins: string[], tenses: Tense[]): Case[] => {
  assert(hindis.length === latins.length && latins.length === tenses.length);
  tenses = tenses.map(x => ({...x}));
  return hindis.map((x, i) => ({hindi: x, latin: latins[i], tense: tenses[i]}));
};

// The table parsing code follows.

const parse_table = <T>(t: T, table: string): {[k in keyof T]: string}[] => {
  // Split the table into lines and validate the header.
  const lines = table.split('\n').map(x => x.trim());
  const valid = lines.filter(x => x.length !== 0 && x[0] !== '#');
  if (valid.length < 3) throw Error(`Invalid table:\n${table}`);
  const columns = valid[0].split('|').map(x => x.trim());
  const keys = Object.keys(t);
  if (keys.length !== columns.length || keys.some(x => !columns.includes(x))) {
    const expected = `(expected: ${keys.join(', ')})`;
    throw Error(`Invalid header: ${columns.join(', ')} ${expected}`);
  }

  // Return a value for each entry of the actual table.
  const grid = valid.slice(2).map(x => x.split('|').map(y => y.trim()));
  return grid.map((x, i) => {
    if (x.length !== columns.length) {
      throw Error(`Invalid line: ${valid[i + 2]}`);
    }
    // tslint:disable-next-line:no-any
    const result: any = {};
    for (let j = 0; j < x.length; j++) {
      if (x[j] === '<') x[j] = x[j - 1];
      if (x[j] === '^') x[j] = grid[i - 1][j];
      if (!x[j]) throw Error(`Invalid line: ${valid[i + 2]}`);
      result[columns[j]] = x[j];
    }
    return result;
  });
};

// Helpers for generating declined adjectives, nouns, and verbs.

const adjectives = (table: string): Entry[] => {
  const entries: Entry[][] = [];
  const example = {meaning: 'small', word: 'chota/cotA'};
  for (const {meaning, word} of parse_table(example, table)) {
    const {hindi, latin} = split(word);
    if (hindi.endsWith('A')) {
      const hindis = ['A', 'e', 'I'].map(x => `${hindi.slice(0, -1)}${x}`);
      const latins = ['a', 'e', 'i'].map(x => `${latin.slice(0, -1)}${x}`);
      const tenses = kVerbTenses;
      entries.push(rollup(zip(hindis, latins, tenses), 'adjective', meaning));
    } else {
      entries.push(rollup([{hindi, latin, tense: {}}], 'adjective', meaning));
    }
  }
  return flatten(entries);
};

const nouns = (table: string): Entry[] => {
  const entries: Entry[][] = [];
  const t = {category: 0, meaning: 0, singular: 0, plural: 0, gender: 0};
  for (const row of parse_table(t, table)) {
    const {category, meaning, singular, plural, gender} = row;
    const g = option(gender, {f: kFeminine, m: kMasculine}, 'gender');
    const base = {...g, person: 'third'};

    // Create entries for the (possibly equal) singular and plural forms.
    const splits = [singular, plural].map(split);
    const hindis = splits.map(x => x.hindi);
    const latins = splits.map(x => x.latin);
    const tenses = [kSingular, kPlural].map(x => ({...base, ...x}));
    entries.push(rollup(zip(hindis, latins, tenses), 'noun', meaning));

    // Add types to each entry based on the category and the count.
    const xs = entries[entries.length - 1];
    xs.forEach(x => {
      x.types.set(category, 0);
      x.tenses.forEach(y => x.types.set(`noun_${y.number}`, 0));
      x.tenses.forEach(y => x.types.set(`${category}_${y.number}`, 0));
    });

    // As an optimization, clean up tenses for non-declining nouns.
    if (singular === plural) xs.forEach(x => (x.tenses = [{...base}]));
  }
  return flatten(entries);
};

const numbers = (table: string): Entry[] => {
  const entries: Entry[][] = [];
  const example = {meaning: '0', word: 'sifar/siPZar'};
  for (const {meaning, word} of parse_table(example, table)) {
    const value = parseInt(meaning, 10);
    if (isNaN(value)) throw Error(`Invalid number: ${value}`);
    const {hindi, latin} = split(word);
    const tense = value === 1 ? kSingular : kPlural;
    entries.push(rollup([{latin, hindi, tense}], 'number', value));
  }
  return flatten(entries);
};

const particles = (table: string): Entry[] => {
  const entries: Entry[][] = [];
  const t = {category: 0, meaning: 0, word: 0, declines: 0};
  for (const row of parse_table(t, table)) {
    const {category, declines, meaning, word} = row;
    const {hindi, latin} = split(word);
    if (option(declines, {n: false, y: true}, 'declines')) {
      if (!hindi.endsWith('A')) throw Error(`Unable to decline: ${hindi}`);
      const tenses = [kMasculine, kFeminine];
      const hindis = ['A', 'I'].map(x => `${hindi.slice(0, -1)}${x}`);
      const latins = ['a', 'i'].map(x => `${latin.slice(0, -1)}${x}`);
      entries.push(rollup(zip(hindis, latins, tenses), 'particle', meaning));
    } else {
      entries.push(rollup([{hindi, latin, tense: {}}], 'particle', meaning));
    }
    entries[entries.length - 1].forEach(x => x.types.set(category, 0));
  }
  return flatten(entries);
};

const pronouns = (table: string): Entry[] => {
  const entries: Entry[][] = [];
  const d = {'dative (1)': '', 'dative (2)': ''};
  const t = {role: '', direct: '', genitive: '', copula: '', ...d};

  const persons = {1: 'first', 2: 'second', 3: 'third'};
  const numbers = {p: 'plural', s: 'singular'};
  const tones = {c: 'casual', f: 'formal', i: 'intimate', ...{'.': null}};
  const meaning = {first: 'I', second: 'you', third: 'they'};

  const group_by_person: {[key: string]: (typeof t)[]} = {};
  for (const row of parse_table({...d, ...t}, table)) {
    const person = option(row.role[0], persons, 'person');
    (group_by_person[person] = group_by_person[person] || []).push(row);
  }

  const copulas: Case[] = [];
  const fn = (): Case[][] => [];

  for (const person of Object.keys(group_by_person).sort()) {
    const cases = {dative: fn(), direct: fn(), genitive: fn()};
    const value = option(person, meaning, 'meaning');

    for (const row of group_by_person[person]) {
      const {copula, direct, genitive, role} = row;
      if (role.length !== 3) throw Error(`Invalid role: ${role}`);
      const number = option(role[1], numbers, 'number');
      const tone = option(role[2], tones, 'tone');
      const base = tone ? {tone} : null;
      const tense = {person, number, ...base};

      {
        // Handle the direct (subject) case.
        const {hindi, latin} = split(direct);
        cases.direct.push([{hindi, latin, tense}]);
      }
      {
        // Handle the genitive (possessive) case.
        const {hindi, latin} = split(genitive);
        if (!hindi.endsWith('A')) throw Error(`Unable to decline: ${hindi}`);
        const hindis = ['A', 'I'].map(x => `${hindi.slice(0, -1)}${x}`);
        const latins = ['a', 'i'].map(x => `${latin.slice(0, -1)}${x}`);
        const tenses = [kMasculine, kFeminine].map(x => ({...base, ...x}));
        cases.genitive.push(zip(hindis, latins, tenses));
      }
      {
        // Handle the dative (indirect object) case.
        const datives = new Set([row['dative (1)'], row['dative (2)']]);
        const splits = Array.from(datives).map(split);
        const hindis = splits.map(x => x.hindi);
        const latins = splits.map(x => x.latin);
        const tenses = splits.map(x => ({...base}));
        cases.dative.push(zip(hindis, latins, tenses));
      }
      {
        // Handle the copula case. The copulas will all have a single stem.
        const {hindi, latin} = split(copula);
        copulas.push({hindi, latin, tense});
      }
    }

    entries.push(rollup(flatten(cases.dative), 'dative', value));
    entries.push(rollup(flatten(cases.direct), 'direct', value));
    entries.push(rollup(flatten(cases.genitive), 'genitive', value));
  }

  entries.push(rollup(copulas, 'copula', 'be'));
  return flatten(entries);
};

const verbs = (table: string): Entry[] => {
  // TODO(skishore): Add command forms here.
  // TODO(skishore): Handle "reversed" verbs like "chahna".
  // TODO(skishore): Handle irregular verbs here ("hona", "jana", etc.)
  // I can't find a complete list. http://www.geocities.ws/lordvaruna/
  // notes all the irregular verbs, but doesn't show some of the modified
  // conjugutions (e.g. the changed future tenses).
  const entries: Entry[][] = [];
  const kBases = [
    {hindi: '', latin: '', type: 'stem'},
    {hindi: 'ne', latin: 'ne', type: 'gerund'},
  ];
  const kForms = [
    {hindi: '', latin: '', prefix: true, time: 'past'},
    {hindi: 'w', latin: 't', prefix: false, time: 'present'},
    {hindi: 'Ung', latin: 'oong', prefix: false, time: 'future'},
  ];
  const example = {meaning: 'eat', word: 'khana/KAnA'};
  for (const {meaning, word} of parse_table(example, table)) {
    // Detect the stem and check if it ends in a vowel.
    const {hindi, latin} = split(word);
    assert(
      hindi.endsWith('nA') && latin.endsWith('na'),
      () => `Invalid infinitive: ${latin}`,
    );
    const h = hindi.slice(0, -2);
    const l = latin.slice(0, -2);
    const vowel = 'aeiou'.indexOf(h.slice(-1).toLowerCase()) >= 0;

    // For each base type, add an entry for the verb.
    for (const base of kBases) {
      const hindis = [`${h}${base.hindi}`];
      const latins = [`${l}${base.latin}`];
      entries.push(rollup(zip(hindis, latins, [{}]), 'verb', meaning));
      const xs = entries[entries.length - 1];
      xs.forEach(x => x.types.set(`verb_${base.type}`, 0));
    }

    // For each form type, add declined entries for that type.
    for (const form of kForms) {
      const y = vowel && form.prefix ? 'y' : '';
      const hindis = ['A', 'e', 'I'].map(x => `${h}${y}${form.hindi}${x}`);
      const latins = ['a', 'e', 'i'].map(x => `${l}${y}${form.latin}${x}`);
      const tenses = kVerbTenses.map(x => ({...x, time: form.time}));
      entries.push(rollup(zip(hindis, latins, tenses), 'verb', meaning));
      const xs = entries[entries.length - 1];
      xs.forEach(x => x.types.set(`verb_${form.time}`, 0));
    }
  }
  return flatten(entries);
};

const Vocabulary = {adjectives, nouns, numbers, particles, pronouns, verbs};

export {Entry, Vocabulary};
