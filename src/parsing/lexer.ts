declare const require: any;
const moo = require('../../src/external/moo.js');

import {Option} from '../lib/base';

// The Lexer interface allows literal- and type-based token matching.

interface Lexer {
  lex: (input: string) => Token[],
  unlex_text: (text: string, value: Option<any>) => Option<string>,
  unlex_type: (type: string, value: Option<any>) => Option<string>,
}

interface Match {
  score: number,
  value: any,
}

interface Token {
  index: number,
  input: string,
  text: string,
  text_matches: {[text: string]: Match},
  type_matches: {[type: string]: Match},
}

// Helper methods common to multiple lexers.

const format_error = (token: Token, message: string): string => {
  const start = token.input.lastIndexOf('\n', token.index - 1) + 1;
  const maybe_end = token.input.indexOf('\n', start);
  const end = maybe_end < 0 ? token.input.length : maybe_end;
  const line = token.input.slice(0, token.index).split('\n').length;
  const column = token.index - start + 1;
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
  lex(input: string) {
    const match = (x: string): Match => ({score: 0, value: x});
    return Array.from(input).map((x, i) => ({
      index: i,
      input,
      text: x,
      text_matches: {[x]: match(x)},
      type_matches: {},
    }));
  }
  unlex_text(text: string, value: Option<any>) {
    if (value && value.some !== text) return null;
    return text.length === 1 ? {some: text} : null;
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
  lex(input: string) {
    const result: Token[] = [];
    for (const token of moo_tokens(input, this.lexer)) {
      const match: Match = {score: 0, value: token.value};
      result.push({
        index: token.offset,
        input,
        text: token.text,
        text_matches: {[token.text]: match},
        type_matches: {[token.type]: match},
      });
    }
    return result;
  }
  unlex_text(text: string, value: Option<any>) {
    if (value && value.some !== text) return null;
    const tokens = moo_tokens(text, this.lexer);
    return tokens.length === 1 ? {some: text} : null;
  }
  unlex_type(type: string, value: Option<any>) {
    if (!value || typeof value.some !== 'string') return null;
    const tokens = moo_tokens(value.some, this.lexer);
    return tokens.length === 1 && tokens[0].type === type ? value : null;
  }
  static string: MooConfig = [
    {match: /"[^"]*"/, value: (x) => JSON.parse(x)},
    {match: /'[^']*'/, value: (x) => JSON.parse(swap_quotes(x))},
  ];
}

export {CharacterLexer, Lexer, Match, MooLexer, Token};
