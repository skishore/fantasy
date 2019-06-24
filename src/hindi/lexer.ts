import {Option, RNG} from '../lib/base';
import {Node, Parser} from '../lib/combinators';
import {Tense, Term, XLexer, XMatch, XToken} from '../nlu/extensions';
import {Payload} from '../payload/base';
import {Transliterator} from './transliterator';
import {Entry} from './vocabulary';

interface XEntry<T> extends Entry {
  parsed_value: T;
}

const agree = (a: Tense, b: Tense): boolean =>
  Object.keys(a).every(k => a[k] === (b[k] || a[k]));

const bests = <T>(xs: T[], fn: (x: T) => number): T[] => {
  const result: T[] = [];
  let best_score = -Infinity;
  for (const x of xs) {
    const score = fn(x);
    if (score < best_score) continue;
    if (score > best_score) result.length = 0;
    best_score = score;
    result.push(x);
  }
  return result;
};

const group = <T>(xs: T[], fn: (x: T) => string[]): Map<string, T[]> => {
  const result = new Map<string, T[]>();
  xs.forEach(x =>
    fn(x).forEach(k => {
      const list = result.get(k) || [];
      result.set(k, list);
      list.push(x);
    }),
  );
  return result;
};

const match = <T>(data_type: Payload<T>, text: string): XMatch<T, 0> => {
  const data = {tenses: [], text: {head: '', hindi: text, latin: text}};
  return {data, score: 0, value: data_type.make_base(text)};
};

const parse = <T>(data_type: Payload<T>, entry: Entry): XEntry<T> => {
  const parsed_value = data_type.parse(entry.value);
  return {...entry, parsed_value, value: data_type.stringify(parsed_value)};
};

// prettier-ignore
const parser: Node<{text: string, token: boolean}[]> = (() => {
  const ws = Parser.regexp(/\s*/m);
  const id = Parser.regexp(/[a-zA-Z0-9]+/).map(x => ({text: x, token: true}));
  const pn = Parser.regexp(/./).map(x => ({text: x, token: false}));
  return ws.then(Parser.any(id, pn).repeat(0, ws)).skip(ws);
})();

const render = <T>(entry: XEntry<T>, score: number): XMatch<T, 0> => {
  const {head, hindi, latin, parsed_value, tenses} = entry;
  const data = {tenses, text: {head, hindi, latin}};
  return {data, score, value: parsed_value};
};

const update = <T>(entry: XEntry<T>, offset: number, token: XToken<T, 0>) => {
  const dummy = {score: -Infinity};
  for (const [name, base] of entry.scores) {
    const score = base + offset;
    if ((token.matches[name] || dummy).score >= score) continue;
    token.matches[name] = render(entry, score);
  }
};

class HindiLexer<T> implements XLexer<T, 0> {
  private data_type: Payload<T>;
  private from_head: Map<string, XEntry<T>[]>;
  private from_name: Map<string, XEntry<T>[]>;
  private from_word: Map<string, XEntry<T>[]>;
  private transliterator: Transliterator;
  constructor(data_type: Payload<T>, entries: Entry[]) {
    const xentries = entries.map(x => parse(data_type, x));
    this.data_type = data_type;
    this.from_head = group(xentries, x => [x.head]);
    this.from_name = group(xentries, x => Array.from(x.scores.keys()));
    this.from_word = group(xentries, x => [x.hindi]);
    this.transliterator = new Transliterator(entries.map(x => x.hindi));
  }
  fix(match: XMatch<T, 0>, tense: Tense): XMatch<T, 0>[] {
    const entries = this.from_head.get(match.data.text.head) || [];
    const serialized = this.data_type.stringify(match.value);
    const fixed = entries.filter(x => {
      if (x.value !== serialized) return false;
      return x.tenses.some(y => agree(tense, y));
    });
    // TODO(skishore): Return the fixed result closest to the original.
    // We should always correct "mera" -> "meri" and not to "hamari".
    return fixed.map(x => render(x, /*score=*/ 0));
  }
  lex(input: string): XToken<T, 0>[] {
    return parser.parse(input).map(x => {
      const {text, token} = x;
      const result: XToken<T, 0> = {matches: {}, text};
      const type = token ? 'token' : 'punctuation';
      result.matches[`%${type}`] = match(this.data_type, text);
      if (!token) return result;
      const options = this.transliterator.transliterate(text);
      options.forEach((y, i) =>
        this.from_word.get(y)!.forEach(z => update(z, -i, result)),
      );
      return result;
    });
  }
  unlex(name: string, value: Option<T>): XMatch<T, 0>[] {
    if (name === '%punctuation' || name === '%token') {
      if (!value) return [match(this.data_type, '')];
      const base = value && this.data_type.is_base(value.some);
      return base === null ? [] : [match(this.data_type, base)];
    }
    let entries = this.from_name.get(name) || [];
    if (value) {
      const serialized = this.data_type.stringify(value.some);
      entries = entries.filter(x => x.value === serialized);
    }
    const fixed = bests(entries, x => x.scores.get(name) || 0);
    return fixed.map(x => render(x, /*score=*/ 0));
  }
}

export {HindiLexer};
