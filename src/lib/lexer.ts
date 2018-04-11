import {clone} from './base';

const kCommentMark = '#';
const kEscapeCodes: {[index: string]: string} =
    {b: '\b', f: '\f', n: '\n', r: '\r', t: '\t'};
const kOpenBraces: {[brace: string]: string} = {'(': ')', '[': ']', '{': '}'};

const kCloseBraces: {[brace: string]: string} = {};
Object.keys(kOpenBraces).forEach((x) => kCloseBraces[kOpenBraces[x]] = x);

type Type = 'close' | 'eof' | 'open' | 'quoted' | 'symbol' | 'unquoted';
interface Token {text: string, type: Type};
interface LexerState {context: string[], index: number, input: string};

const identifier = (x: string) => /[a-zA-Z0-9$_]/.test(x);

class Lexer {
  private state: LexerState;
  constructor(input: string) {
    this.state = {context: [], index: 0, input};
  }
  error(message: string): Error {
    const index = Math.max(this.state.index - 1, 0);
    const line = Array.from(this.state.input.slice(0, index))
                      .filter((x) => x === '\n').length;
    const lines = this.state.input.split('\n');
    const total = lines.slice(0, line).map((x) => x.length)
                       .reduce((x, acc) => x + acc, 0);
    const offset = index - line - total;
    const marker = `${lines[line]}\n${Array(offset).fill(' ').join('')}^`;
    return Error(`At ${line}:${offset}: ${message}\n${marker}`);
  }
  match(text: string): void {
    const next = this.next().text;
    if (next !== text) throw this.error(`Expected: ${text}; got: ${next}`);
  }
  maybe_match(text: string): boolean {
    if (this.peek().text !== text) return false;
    this.match(text);
    return true;
  }
  next(): Token {
    while (this.state.index < this.state.input.length) {
      const ch = this.state.input[this.state.index++];
      if (ch === kCommentMark) {
        this.parse_comment();
        continue;
      }
      if (/\s/.test(ch)) continue;
      return this.parse_next(ch);
    }
    if (this.state.context.length > 0) {
      throw this.error(`Unclosed brace: ${this.state.context.pop()}`);
    }
    return {text: '<EOF>', type: 'eof'};
  }
  peek(): Token {
    const state = this.state;
    this.state = clone(state);
    const result = this.next();
    this.state = state;
    return result;
  }
  private parse_comment(): void {
    while (this.state.index < this.state.input.length) {
      const ch = this.state.input[this.state.index++];
      if (ch === '\n') return;
    }
  }
  private parse_next(ch: string): Token {
    if (kOpenBraces[ch]) {
      this.state.context.push(ch);
      return {text: ch, type: 'open'};
    } else if (kCloseBraces[ch]) {
      if (this.state.context.length === 0 ||
          this.state.context.pop() !== kCloseBraces[ch]) {
        throw this.error(`Unexpected close brace: ${ch}`);
      }
      return {text: ch, type: 'close'};
    } else if (ch === '"' || ch === "'") {
      return this.parse_quoted_atom(ch);
    } else if (identifier(ch)) {
      this.state.index -= 1;
      return this.parse_unquoted_atom();
    }
    return {text: ch, type: 'symbol'};
  }
  private parse_quoted_atom(quote: string): Token {
    const result: string[] = [];
    while (this.state.index < this.state.input.length) {
      const ch = this.state.input[this.state.index++];
      if (ch === quote) {
        return {text: result.join(''), type: 'quoted'};
      } else if (ch === '\\') {
        if (this.state.index === this.state.input.length) {
          throw this.error('Unterminated escape code.');
        }
        const next = this.state.input[this.state.index++];
        result.push(kEscapeCodes[next] || next);
      } else {
        result.push(ch);
      }
    }
    throw this.error(`Unexpected end of input: ${result.join('')}`);
  }
  private parse_unquoted_atom(): Token {
    const result: string[] = [];
    while (this.state.index < this.state.input.length) {
      const ch = this.state.input[this.state.index++];
      if (!identifier(ch)) {
        this.state.index -= 1;
        break;
      } else if (kOpenBraces[ch]) {
        throw this.error(`Unexpected open brace: ${ch}`);
      }
      result.push(ch);
    }
    return {text: result.join(''), type: 'unquoted'};
  }
};

export {Lexer};
