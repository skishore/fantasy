import {Option, assert, flatten, group, sample} from '../lib/base';
import {Lexer, MooLexer, Match, Tense} from '../parsing/lexer';
import {Transliterator} from './transliterator'
import {Entry} from './vocabulary'

const equal = (a: any, b: any): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  return subset(a, b) && subset(b, a);
}

const render = (entry: Entry, score: number): Match => {
  if (!entry.tenses) return {data: entry, score, value: entry.value};
  return {data: entry, score, tenses: entry.tenses, value: entry.value};
}

const subset = (a: Tense, b: Tense): boolean => {
  return Object.keys(a).every((x) => equal(a[x], b[x]));
}

class HindiLexer implements Lexer {
  private entries: Entry[];
  private lexer: Lexer;
  private lookup_by_head: {[head: string]: Entry[]};
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
    this.lookup_by_head = group(entries, (x) => x.head);
    this.lookup_by_type = group(entries, (x) => x.type);
    this.lookup_by_wx = group(entries, (x) => x.wx);
    const words = entries.map((x) => x.wx);
    this.transliterator = new Transliterator(words);
  }
  join(matches: Match[]) {
    const text = (x: string | Entry) => typeof x === 'string' ? x : x.latin;
    return matches.map((x) => text(x.data)).join('');
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
      const transliterations = this.transliterator.transliterate(text);
      transliterations.reverse().forEach((y, i) => {
        this.lookup_by_wx[y].forEach((z) => {
          const match = render(z, /*score=*/transliterations.length - i - 1);
          x.text_matches[z.head] = match;
          x.type_matches[z.type] = match;
        });
      });
      return x;
    });
  }
  match_tense(match: Match, tense: Tense) {
    const entries = this.lookup_by_head[match.data.head] || [];
    const entry = sample(entries.filter((x) => {
      if (!equal(x.value, match.value)) return false;
      const tenses = x.tenses;
      return !tenses || tenses.some((y) => subset(tense, y));
    }));
    return entry ? {some: render(entry, /*score=*/0)} : null;
  }
  unlex_text(text: string, value: Option<any>) {
    let entries = this.lookup_by_head[text] || [];
    if (value) entries = entries.filter((x) => equal(x.value, value.some));
    const entry = sample(entries);
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
    const entry = sample(entries);
    return entry ? {some: render(entry, /*score=*/0)} : null;
  }
}

export {HindiLexer};
