declare const require: any;
const moo = require('../../src/external/moo.js');

import {Option} from '../lib/base';

// The Lexer interface allows literal- and type-based token matching.

interface Tense {[axis: string]: string};

interface Lexer {
  join: (matches: Match[]) => string,
  lex: (input: string) => Token[],
  match_tense: (match: Match, tense: Tense) => Option<Match>,
  unlex_text: (text: string, value: Option<any>) => Option<Match>,
  unlex_type: (type: string, value: Option<any>) => Option<Match>,
}

interface Match {
  data?: any,
  score: number,
  tenses?: Tense[],
  value: any,
}

interface Token {
  input: string,
  range: [number, number],
  text_matches: {[text: string]: Match},
  type_matches: {[type: string]: Match},
}

// Helper methods common to multiple lexers.

const format_error = (token: Token, message: string): string => {
  const index = token.range[0];
  const start = token.input.lastIndexOf('\n', index - 1) + 1;
  const maybe_end = token.input.indexOf('\n', start);
  const end = maybe_end < 0 ? token.input.length : maybe_end;
  const line = token.input.slice(0, index).split('\n').length;
  const column = index - start + 1;
  const highlight = token.input.substring(start, end);
  return `
${message} at line ${line}, column ${column}:

  ${highlight}
  ${Array(column).join(' ')}^
  `.trim();
}

const moo_tokens = (input: string, lexer: Moo): MooToken[] => {
  const result = [];
  lexer.reset(input);
  /* tslint:disable-next-line:no-conditional-assignment */
  for (let token = null; token = lexer.next();) {
    result.push(token);
  }
  return result;
}

const swap_quotes = (x: string) =>
    x.replace(/[\'\"]/g, (y) => y === '"' ? "'" : '"');

const Lexer = {format_error, swap_quotes};

// A lexer that splits a string into raw characters.

class CharacterLexer implements Lexer {
  join(matches: Match[]) {
    return matches.map((x) => x.value).join('');
  }
  lex(input: string) {
    const match = (x: string): Match => ({score: 0, value: x});
    return Array.from(input).map<Token>((x, i) => ({
      input,
      range: [i, i + 1],
      text_matches: {[x]: match(x)},
      type_matches: {},
    }));
  }
  match_tense(match: Match, tense: Tense) {
    return {some: match};
  }
  unlex_text(text: string, value: Option<any>) {
    if (value && value.some !== text) return null;
    const match = {score: 0, text, value: text};
    return text.length === 1 ? {some: match} : null;
  }
  unlex_type(type: string, value: Option<any>) {
    return null;
  }
}

// A lexer that uses the moo.js library to split a string into tokens.

interface Moo {
  next: () => MooToken | null,
  reset: (input: string) => void,
}

interface MooRule {
  match: string | RegExp,
  value?: (x: string) => any,
}

type MooConfig = MooRule | MooRule[] | MooRule['match'];

interface MooToken {
  offset: number,
  text: string,
  type: string,
  value: any,
}

class MooLexer implements Lexer {
  private lexer: Moo;
  constructor(config: {[cls: string]: MooConfig}) {
    this.lexer = moo.compile(config);
  }
  join(matches: Match[]) {
    return matches.map((x) => x.data).join('');
  }
  lex(input: string) {
    const result: Token[] = [];
    for (const token of moo_tokens(input, this.lexer)) {
      const {offset, text, type, value} = token;
      const match: Match = {data: text, score: 0, value};
      result.push({
        input,
        range: [offset, offset + text.length],
        text_matches: {[text]: match},
        type_matches: {[type]: match},
      });
    }
    return result;
  }
  match_tense(match: Match, tense: Tense) {
    return {some: match};
  }
  unlex_text(text: string, value: Option<any>) {
    if (value && value.some !== text) return null;
    const tokens = moo_tokens(text, this.lexer);
    if (tokens.length !== 1) return null;
    return {some: {data: tokens[0].text, score: 0, value: tokens[0].value}};
  }
  unlex_type(type: string, value: Option<any>) {
    if (!value || typeof value.some !== 'string') return null;
    const tokens = moo_tokens(value.some, this.lexer);
    if (tokens.length !== 1 || tokens[0].type !== type) return null;
    return {some: {data: tokens[0].text, score: 0, value: tokens[0].value}};
  }
  static float: MooConfig = {
    match: /-?(?:[0-9]|[1-9][0-9]+)(?:\.[0-9]+)\b/,
    value: (x) => parseFloat(x),
  };
  static integer: MooConfig = {
    match: /-?(?:[0-9]|[1-9][0-9]+)\b/,
    value: (x) => parseInt(x, 10),
  };
  static string: MooConfig = [
    {match: /"[^"]*"/, value: (x) => JSON.parse(x)},
    {match: /'[^']*'/, value: (x) => JSON.parse(swap_quotes(x))},
  ];
}

export {Tense, CharacterLexer, Lexer, Match, MooLexer, Token};
