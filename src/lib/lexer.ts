// Our recursive-descent parser-lexers use moo.js internally.

declare const require: any;
const moo = require('../../src/external/moo.js');

const swap_quotes = (x: string): string =>
  x.replace(/[\'\"]/g, (y) => y === '"' ? "'" : '"');

const error = (input: string, offset: number) => (message: string): Error => {
  offset = Math.max(Math.min(offset, input.length - 1), 0);
  const start = input.lastIndexOf('\n', offset - 1) + 1;
  const maybe_end = input.indexOf('\n', start);
  const end = maybe_end < 0 ? input.length : maybe_end;
  const line = input.slice(0, offset).split('\n').length;
  const column = offset - start + 1;
  const highlight = input.substring(start, end);
  const error = `
At line ${line}, column ${column}: ${message}

  ${highlight}
  ${Array(column).join(' ')}^
  `.trim();
  return Error(error);
}

const lexer = moo.compile({
  block: {match: /{%[^]*?[%]}/, value: (x: string) => x.slice(2, -2).trim()},
  close: /[)}\]]/,
  comment: /#.*$/,
  error: [/"[^"]*$/, /'[^']*$/],
  id: /[a-zA-Z_][a-zA-Z0-9_]*/,
  num: [
    /-?(?:[0-9]|[1-9][0-9]+)?(?:\.[0-9]+)\b/,
    /-?(?:[0-9]|[1-9][0-9]+)\b/,
  ],
  open: /[({[]/,
  str: [
    {match: /"[^"]*"/, value: (x: string) => JSON.parse(x)},
    {match: /'[^']*'/, value: (x: string) => JSON.parse(swap_quotes(x))},
  ],
  whitespace: /\s+/,
  sym: /./,
});

const match = (tokens: Token[], eof: Token): Token[] => {
  const stack: string[] = [];
  for (const token of tokens) {
    if (token.type === 'open') {
      stack.push(token.text);
    } else if (token.type === 'close') {
      const last = (stack.pop() || '').charCodeAt(0);
      const next = token.text.charCodeAt(0);
      if (next - last !== 1 && next - last !== 2) {
        throw token.error(`Unexpected close brace: ${token.text}`);
      }
    }
  }
  const unclosed = stack.pop();
  if (unclosed) throw eof.error(`Unclosed brace: ${unclosed}`);
  return tokens;
}

const split = (input: string): Token[] => {
  const result: Token[] = [];
  lexer.reset(input);
  /* tslint:disable-next-line:no-conditional-assignment */
  for (let token = null; token = lexer.next();) {
    const {offset, text, type, value} = token;
    if (type === 'comment' || type === 'whitespace') continue;
    if (type === 'error') {
      const message = `Invalid string literal: ${text.split('\n')[0]}`;
      throw error(input, offset)(message);
    }
    const fn = error(input, offset);
    result.push({error: fn, input, offset, text, type, value});
  }
  return result;
}

// The public interface of this file.

type Type = 'block' | 'close' | 'eof' | 'id' | 'num' | 'open' | 'str' | 'sym';

interface Token {
  error: (message: string) => Error,
  input: string,
  offset: number,
  text: string,
  type: Type,
  value: string,
};

class Lexer {
  private eof: Token;
  private offset: number;
  private tokens: Token[];
  constructor(input: string) {
    const offset = input.length;
    const [fn, value] = [error(input, offset), '<EOF>'];
    this.eof = {error: fn, input, offset, text: '', type: 'eof', value};
    this.offset = 0;
    this.tokens = split(input);
    match(this.tokens, this.eof);
  }
  match(text: string): void {
    const next = this.next();
    if (next.text !== text) {
      throw next.error(`Expected: ${text}; got: ${next.text}`);
    }
  }
  maybe_match(text: string): boolean {
    if (this.peek().text !== text) return false;
    return this.match(text) || true;
  }
  next(): Token {
    return this.tokens[this.offset++] || this.eof
  }
  peek(): Token {
    return this.tokens[this.offset] || this.eof
  }
};

export {Lexer, Token, swap_quotes};
