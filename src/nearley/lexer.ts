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
}

export {CharacterLexer, Lexer, MooLexer};

// A quick test of the lexer behavior.

const swap_quotes = (x: string) => x.replace(/[\'\"]/g, (y) => y === '"' ? "'" : '"');

//const lexer = new MooLexer({
//  boolean: {match: /(?:false|true)\b/, value: (x: string) => x === 'true'},
//  float: {match: /-?(?:[0-9]|[1-9][0-9]+)(?:\.[0-9]+)\b/, value: (x: string) => parseFloat(x)},
//  identifier: /[a-zA-Z_][a-zA-Z0-9_]*/,
//  integer: {match: /-?(?:[0-9]|[1-9][0-9]+)\b/, value: (x: string) => parseInt(x, 10)},
//  string: [
//    {match: /"[^"]*"/, value: (x: string) => JSON.parse(x)},
//    {match: /'[^']*'/, value: (x: string) => JSON.parse(swap_quotes(x))},
//  ],
//  whitespace: {match: /\s+/},
//  _: /./,
//});
//
//const util = require('util');
//const config = {colors: true, depth: null};
//const debug = (x: any) => util.inspect(x, config);
//console.log(debug(lexer.iterable('[false, 0.5, 1]')));

const lexer = new MooLexer({
  block: {match: /{%[^]*?%}/, value: (x: string) => x.slice(2, -2).trim()},
  comment: {match: /#.*$/, value: (x: string) => null},
  identifier: /[a-zA-Z_][a-zA-Z0-9_]*/,
  string: [
    {match: /"[^"]*"/, value: (x: string) => JSON.parse(x)},
    {match: /'[^']*'/, value: (x: string) => JSON.parse(swap_quotes(x))},
  ],
  whitespace: {match: /\s+/, value: () => null},
  _: /./,
});

const fs = require('fs');
const util = require('util');
const config = {colors: true, depth: null};
const debug = (x: any) => util.inspect(x, config);
const name = 'dsl/value_template.ne';
fs.readFile(name, {encoding: 'utf8'}, (error: Error, data: string) => {
  console.log(debug(lexer.iterable(data)));
});
