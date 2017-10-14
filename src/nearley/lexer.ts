declare const require: any;
const moo = require('./moo');

// The Lexer interface allows literal- and type-based token matching.

interface Lexer {
  iterable: (input: string) => Iterable<Token>,
}

interface Match {
  score: number,
  value: any,
}

interface Token {
  text: {[text: string]: Match},
  type: {[type: string]: Match},
}

// Some simple implementations of lexers.

class CharacterLexer implements Lexer {
  iterable(input: string) {
    const match = (x: string): Match => ({score: 0, value: x});
    return Array.from(input).map((x) => ({text: {[x]: match(x)}, type: {}}));
  }
}

interface MooRule {
  match: string | RegExp,
  value?: (x: string) => any,
}

type MooConfig = MooRule | MooRule[] | MooRule['match'];

const swap_quotes = (x: string) =>
    x.replace(/[\'\"]/g, (y) => y === '"' ? "'" : '"');

class MooLexer implements Lexer {
  private lexer: any;
  constructor(config: {[cls: string]: MooConfig}) {
    this.lexer = moo.compile(config);
  }
  iterable(input: string) {
    const result: Token[] = [];
    this.lexer.reset(input);
    let token: {text: string, type: string, value: any} = this.lexer.next();
    while (!!token) {
      const match: Match = {score: 0, value: token.value};
      result.push({text: {[token.text]: match}, type: {[token.type]: match}});
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
