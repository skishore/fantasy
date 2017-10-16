declare const require: any;
const moo = require('../../src/external/moo.js');

// The Lexer interface allows literal- and type-based token matching.

interface Lexer {
  iterable: (input: string) => Iterable<Token>,
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

const swap_quotes = (x: string) =>
    x.replace(/[\'\"]/g, (y) => y === '"' ? "'" : '"');

const Lexer = {format_error, swap_quotes};

// Some simple implementations of lexers.

class CharacterLexer implements Lexer {
  iterable(input: string) {
    const match = (x: string): Match => ({score: 0, value: x});
    return Array.from(input).map((x, i) => ({
      index: i,
      input,
      text: x,
      text_matches: {[x]: match(x)},
      type_matches: {},
    }));
  }
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
  private lexer: any;
  constructor(config: {[cls: string]: MooConfig}) {
    this.lexer = moo.compile(config);
  }
  iterable(input: string) {
    const result: Token[] = [];
    this.lexer.reset(input);
    let token: MooToken | null = this.lexer.next();
    while (!!token) {
      const match: Match = {score: 0, value: token.value};
      result.push({
        index: token.offset,
        input,
        text: token.text,
        text_matches: {[token.text]: match},
        type_matches: {[token.type]: match},
      });
      token = this.lexer.next();
    }
    return result;
  }
  static string: MooConfig = [
    {match: /"[^"]*"/, value: (x) => JSON.parse(x)},
    {match: /'[^']*'/, value: (x) => JSON.parse(swap_quotes(x))},
  ];
}

export {CharacterLexer, Lexer, Match, MooLexer, Token};
