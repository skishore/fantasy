import {assert, flatten} from '../lib/base';
import {Tense} from '../parsing/extensions';

interface Entry {
  head: string;
  hindi: string;
  latin: string;
  scores: Map<string, number>;
  tenses: Tense[];
  value: string;
}

// Boilerplate helpers needed to support the core declension routines.

interface Case extends Word {
  tense: Tense;
}

interface Word {
  hindi: string;
  latin: string;
}

const kFeminine: Tense = {gender: 'feminine'};
const kMasculine: Tense = {gender: 'masculine'};

const kPlural: Tense = {count: 'plural'};
const kSingular: Tense = {count: 'singular'};

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

const rollup = (cases: Case[], type: string, value: string): Entry[] => {
  // Collect the set of distinct words and a base entry common to them all.
  assert(cases.length > 0, () => `Invalid cases for type: ${type}`);
  const head = `${type}-${cases[0].hindi}`;
  const hindis = Array.from(new Set(cases.map(x => x.hindi)).keys());

  // Return one entry for each distinct Hindi word.
  return hindis.map(hindi => {
    const matched_cases = cases.filter(x => x.hindi === hindi);
    const latin = matched_cases[0].latin;
    const scores = new Map([[`%${type}`, 0]]);
    cases.forEach(y => scores.set(y.latin, y.hindi === hindi ? 0 : -1));
    const tenses = matched_cases.map(x => x.tense);
    return {head, hindi, latin, scores, tenses, value};
  });
};

const split = (x: string): Word => {
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

// Helpers for automatically computing different forms of words.

const pluralize = (gender: string, noun: Word): Word => {
  const {hindi, latin} = noun;
  if (gender === 'm' && hindi.endsWith('A')) {
    return {hindi: `${hindi.slice(0, -1)}e`, latin: `${latin.slice(0, -1)}e`};
  } else if (gender === 'f' && hindi.endsWith('I')) {
    return {hindi: `${hindi}yAM`, latin: `${latin}ya`};
  }
  const kOverrides: {[spec: string]: string} = {
    'aurat/Oraw': 'aurte/Orwe',
  };
  const spec = kOverrides[`${latin}/${hindi}`];
  if (!spec) throw Error(`Unable to pluralize: ${hindi}`);
  return split(spec);
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
  const t = {category: 0, role: 0, meaning: 0, word: 0};
  for (const row of parse_table(t, table)) {
    const {category, role, meaning, word} = row;
    const gender = option(role[0], {f: kFeminine, m: kMasculine}, 'gender');
    const {hindi, latin} = split(word);
    const tense = {...gender, person: 'third'};

    // Create multiple forms for nouns with a plural declension.
    if (role[1] !== '.') {
      const singular = {hindi, latin};
      const splits = [singular, pluralize(role[0], singular)];
      const hindis = splits.map(x => x.hindi);
      const latins = splits.map(x => x.latin);
      const tenses = [kSingular, kPlural].map(x => ({...tense, ...x}));
      entries.push(rollup(zip(hindis, latins, tenses), 'noun', meaning));
    } else {
      entries.push(rollup([{hindi, latin, tense}], 'noun', meaning));
    }

    // Add types to each entry based on the category and the count.
    const xs = entries[entries.length - 1];
    xs.forEach(x => {
      x.scores.set(`%${category}`, 0);
      let counts = x.tenses.filter(x => !!x.count);
      if (counts.length === 0) counts = [kSingular, kPlural];
      counts.forEach(y => x.scores.set(`%noun_${y.count}`, 0));
      counts.forEach(y => x.scores.set(`%${category}_${y.count}`, 0));
    });
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
    entries.push(rollup([{latin, hindi, tense}], 'number', meaning));
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
      const hindis = ['A', 'e', 'I'].map(x => `${hindi.slice(0, -1)}${x}`);
      const latins = ['a', 'e', 'i'].map(x => `${latin.slice(0, -1)}${x}`);
      const tenses = kVerbTenses;
      entries.push(rollup(zip(hindis, latins, tenses), 'particle', meaning));
    } else {
      entries.push(rollup([{hindi, latin, tense: {}}], 'particle', meaning));
    }
    entries[entries.length - 1].forEach(x => x.scores.set(`%${category}`, 0));
  }
  return flatten(entries);
};

const pronouns = (table: string): Entry[] => {
  const entries: Entry[][] = [];
  const d = {'dative (1)': '', 'dative (2)': ''};
  const t = {role: '', direct: '', genitive: '', copula: '', ...d};

  const persons = {1: 'first', 2: 'second', 3: 'third'};
  const counts = {p: 'plural', s: 'singular'};
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
      const count = option(role[1], counts, 'count');
      const tone = option(role[2], tones, 'tone');
      const base = tone ? {tone} : null;
      const tense = {person, count, ...base};

      {
        // Handle the direct (subject) case.
        const {hindi, latin} = split(direct);
        cases.direct.push([{hindi, latin, tense}]);
      }
      {
        // Handle the genitive (possessive) case.
        const {hindi, latin} = split(genitive);
        if (!hindi.endsWith('A')) throw Error(`Unable to decline: ${hindi}`);
        const hindis = ['A', 'e', 'I'].map(x => `${hindi.slice(0, -1)}${x}`);
        const latins = ['a', 'e', 'i'].map(x => `${latin.slice(0, -1)}${x}`);
        const tenses = kVerbTenses.map(x => ({...base, ...x}));
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
    {hindi: 'nA', latin: 'na', type: 'infinitive'},
  ];
  const kForms = [
    {hindi: '', latin: '', prefix: true, time: 'past'},
    {hindi: 'w', latin: 't', prefix: false, time: 'present'},
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
      xs.forEach(x => x.scores.set(`%verb_${base.type}`, 0));
    }

    // For each form type, add declined entries for that type.
    for (const form of kForms) {
      const y = vowel && form.prefix ? 'y' : '';
      const hindis = ['A', 'e', 'I'].map(x => `${h}${y}${form.hindi}${x}`);
      const latins = ['a', 'e', 'i'].map(x => `${l}${y}${form.latin}${x}`);
      const tenses = kVerbTenses.map(x => ({...x, time: form.time}));
      entries.push(rollup(zip(hindis, latins, tenses), 'verb', meaning));
      const xs = entries[entries.length - 1];
      xs.forEach(x => x.scores.set(`%verb_${form.time}`, 0));
    }

    // The future tense is special: it has different forms based on person.
    for (const form of [{time: 'future'}]) {
      const hs = 'UngA egA egA enge ogA enge enge'.split(' ');
      const ls = 'unga ega ega enge oga enge enge'.split(' ');
      const basics = [
        {...kSingular, person: 'first'},
        {...kSingular, person: 'second'},
        {...kSingular, person: 'third'},
        {...kPlural, person: 'first'},
        {...kPlural, person: 'second', tone: 'casual'},
        {...kPlural, person: 'second', tone: 'formal'},
        {...kPlural, person: 'third'},
      ];
      const hindis = hs
        .concat(hs.map(x => `${x.slice(0, -1)}I`))
        .map(x => `${h}${x}`);
      const latins = ls
        .concat(ls.map(x => `${x.slice(0, -1)}i`))
        .map(x => `${l}${x}`);
      const tenses = basics
        .map(x => ({...x, ...kMasculine, time: 'future'}))
        .concat(basics.map(x => ({...x, ...kFeminine, time: 'future'})));
      entries.push(rollup(zip(hindis, latins, tenses), 'verb', meaning));
      const xs = entries[entries.length - 1];
      xs.forEach(x => x.scores.set(`%verb_${form.time}`, 0));
    }
  }
  return flatten(entries);
};

const Vocabulary = {adjectives, nouns, numbers, particles, pronouns, verbs};

export {Entry, Vocabulary};
