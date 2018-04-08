import {Option, assert, flatten, sample} from '../lib/base';
import {Lexer, MooLexer, Match, Tense, Token} from '../parsing/lexer';
import {Transliterator} from './transliterator'
import {Entry} from './vocabulary'

const agree = (a: Tense, b: Tense): boolean => {
  return Object.keys(a).filter((x) => b.hasOwnProperty(x))
                       .every((x) => a[x] === b[x]);
}

const argmaxes = <T>(xs: T[], fn: (x: T) => number): T[] => {
  let best_score = -Infinity;
  const result = [];
  for (const x of xs) {
    const score = fn(x);
    if (score < best_score) continue;
    if (score > best_score) {
      best_score = score;
      result.length = 0;
    }
    result.push(x);
  }
  return result;
}

const equal = (a: any, b: any): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  const [keys_a, keys_b] = [Object.keys(a), Object.keys(b)];
  return keys_a.length === keys_b.length &&
         keys_a.every((x) => equal(a[x], b[x]));
}

const group = <T>(xs: T[], fn: (x: T) => string[]): {[key: string]: T[]} => {
  const result: {[key: string]: T[]} = {};
  for (const x of xs) {
    for (const key of fn(x)) {
      (result[key] = result[key] || []).push(x);
    }
  }
  return result;
}

const populate = (entry: Entry, offset: number, token: Token): void => {
  const dummy = {score: -Infinity};
  for (const [text, base] of entry.texts) {
    const score = base + offset;
    if ((token.text_matches[text] || dummy).score >= score) continue;
    token.text_matches[text] = render(entry, score);
  }
  for (const [type, base] of entry.types) {
    const score = base + offset;
    if ((token.type_matches[type] || dummy).score >= score) continue;
    token.type_matches[type] = render(entry, score);
  }
}

const render = (entry: Entry, score: number): Match => {
  if (!entry.tenses) return {data: entry, score, value: entry.value};
  return {data: entry, score, tenses: entry.tenses, value: entry.value};
}

const text = (x: string | Entry, i: number): string => {
  if (typeof x === 'string') return x;
  return i === 0 ? `${x.latin[0].toUpperCase()}${x.latin.slice(1)}` : x.latin;
}

class HindiLexer implements Lexer {
  private entries: Entry[];
  private lexer: Lexer;
  private lookup_by_head: {[head: string]: Entry[]};
  private lookup_by_text: {[text: string]: Entry[]};
  private lookup_by_type: {[type: string]: Entry[]};
  private lookup_by_wx: {[wx: string]: Entry[]};
  private transliterator: Transliterator;
  constructor(entries: Entry[]) {
    this.entries = entries;
    this.lexer = new MooLexer({
      identifier: /[a-zA-Z_][a-zA-Z0-9_]*/,
      whitespace: {match: /\s+/, value: () => null},
      _: /./,
    });
    this.lookup_by_head = group(entries, (x) => [x.head]);
    this.lookup_by_text = group(entries, (x) => Array.from(x.texts.keys()));
    this.lookup_by_type = group(entries, (x) => Array.from(x.types.keys()));
    this.lookup_by_wx = group(entries, (x) => [x.wx]);
    const words = entries.map((x) => x.wx);
    this.transliterator = new Transliterator(words);
  }
  join(matches: Match[]) {
    return matches.map((x, i) => text(x.data, i)).join('');
  }
  lex(input: string) {
    return this.lexer.lex(input).map((x) => {
      // Deal with non-identifier tokens, which are given type '_'.
      const text = x.input.substring(x.range[0], x.range[1]);
      const type = Object.keys(x.type_matches)[0];
      assert(!!type, () => `Invalid MooLexer token: ${x}`);
      const match = {data: text, score: 0, value: text};
      if (type !== 'identifier') {
        x.text_matches = {};
        x.type_matches = {_: match};
        return x;
      }
      // Deal with identifier tokens. These tokens are all given a type match
      // for the type 'token'. Additionally, if they match a dictionary entry,
      // they will be given other text and type matches.
      x.text_matches = {};
      x.type_matches = {token: match};
      this.transliterator.transliterate(text).forEach((y, i) =>
          this.lookup_by_wx[y].forEach((z) => populate(z, -i, x)));
      return x;
    });
  }
  match_tense(match: Match, tense: Tense) {
    const entries = this.lookup_by_head[match.data.head] || [];
    const entry = sample(entries.filter((x) => {
      if (!equal(x.value, match.value)) return false;
      const tenses = x.tenses;
      return !tenses || tenses.some((y) => agree(tense, y));
    }));
    return entry ? {some: render(entry, /*score=*/0)} : null;
  }
  unlex_text(text: string, value: Option<any>) {
    let entries = this.lookup_by_text[text] || [];
    if (value) entries = entries.filter((x) => equal(x.value, value.some));
    const entry = sample(argmaxes(entries, (x) => x.texts.get(text)!));
    return entry ? {some: render(entry, /*score=*/0)} : null;
  }
  unlex_type(type: string, value: Option<any>) {
    const subtypes = {_: ['_', 'whitespace'], token: ['identifier']};
    if (type === '_' || type === 'token') {
      if (!value || typeof value.some !== 'string') return null;
      const subtypes = type === '_' ? ['_', 'whitespace'] : ['identifier'];
      for (const subtype of subtypes) {
        const result = this.lexer.unlex_type(subtype, value);
        if (result) return {some: {data: value.some, score: 0, value}};
      }
      return null;
    }
    let entries = this.lookup_by_type[type] || [];
    if (value) entries = entries.filter((x) => equal(x.value, value.some));
    const entry = sample(argmaxes(entries, (x) => x.types.get(type)!));
    return entry ? {some: render(entry, /*score=*/0)} : null;
  }
}

export {HindiLexer};