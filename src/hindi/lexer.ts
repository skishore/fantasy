import {Option, assert, flatten, group, sample} from '../lib/base';
import {Lexer, MooLexer, Match, Tense} from '../parsing/lexer';
import {Transliterator} from './transliterator'
import {Entry} from './vocabulary'

const equal = (a: any, b: any): boolean => {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  return subset(a, b) && subset(b, a);
}

const render = (entry: Entry, score: number): Match =>
    ({data: entry, score, tenses: entry.tenses, value: entry.value});

const subset = (a: Tense, b: Tense): boolean => {
  return Object.keys(a).every((x) => equal(a, b));
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
      this.transliterator.transliterate(text).forEach((y) => {
        this.lookup_by_wx[y].forEach((z, i) => {
          const match = render(z, /*score=*/-i);
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
    const types = {_: ['_', 'whitespace'], token: ['identifier']};
    if (type === '_' || type === 'token') {
      if (!value || typeof value.some !== 'string') return null;
      return this.lexer.unlex_text(value.some, /*value=*/null);
    }
    let entries = this.lookup_by_type[type] || [];
    if (value) entries = entries.filter((x) => equal(x.value, value.some));
    const entry = sample(entries);
    return entry ? {some: render(entry, /*score=*/0)} : null;
  }
}

export {HindiLexer};
