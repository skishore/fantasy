import {Lexer, Token} from '../../src/lib/lexer';
import {Test} from '../test';

const filter = (token: Token): any => {
  return {text: token.text, type: token.type};
}

const tokens = (input: string): string[] => {
  const result = [];
  const lexer = new Lexer(input);
  while (true) {
    const {text, type} = lexer.next();
    if (type === 'eof') return result;
    result.push(text);
  }
}

const lexer: Test = {
  lexer_assigns_token_types: () => {
    const lexer = new Lexer('("abc" + $1)');
    Test.assert_eq(filter(lexer.next()), {text: '(', type: 'open'});
    Test.assert_eq(filter(lexer.next()), {text: '"abc"', type: 'str'});
    Test.assert_eq(filter(lexer.next()), {text: '+', type: 'sym'});
    Test.assert_eq(filter(lexer.next()), {text: '$', type: 'sym'});
    Test.assert_eq(filter(lexer.next()), {text: '1', type: 'num'});
    Test.assert_eq(filter(lexer.next()), {text: ')', type: 'close'});
    Test.assert_eq(filter(lexer.next()), {text: '', type: 'eof'});
  },
  lexer_parses_atoms: () => {
    Test.assert_eq(tokens('abc $def "g.h.i"'), ['abc', '$', 'def', '"g.h.i"']);
  },
  lexer_parses_empty_input: () => {
    Test.assert_eq(tokens(''), []);
  },
  lexer_parses_blank_input: () => {
    Test.assert_eq(tokens(' '), []);
  },
  lexer_parses_braces: () => {
    Test.assert_eq(tokens('()'), ['(', ')']);
  },
  lexer_parses_braces_and_atoms: () => {
    Test.assert_eq(tokens('(a b c)'), ['(', 'a', 'b', 'c', ')']);
  },
  lexer_parses_nested_braces: () => {
    Test.assert_eq(tokens('(a [] (d {f}))'),
                   ['(', 'a', '[', ']', '(', 'd', '{', 'f', '}', ')', ')']);
  },
  lexer_parses_symbols: () => {
    Test.assert_eq(tokens('g.h.i'), ['g', '.', 'h', '.', 'i']);
  },
  lexer_handles_comments: () => {
    Test.assert_eq(tokens('(a # comment\nb c)'), ['(', 'a', 'b', 'c', ')']);
  },
  lexer_handles_whitespace: () => {
    Test.assert_eq(tokens('(a b\nc)'), ['(', 'a', 'b', 'c', ')']);
  },
  lexer_handles_trailing_whitespace: () => {
    Test.assert_eq(tokens('(a b c) '), ['(', 'a', 'b', 'c', ')']);
  },
  lexer_fails_on_extra_brace: () => {
    Test.assert_error(() => tokens(')'), 'Unexpected close brace: )');
  },
  lexer_fails_on_invalid_string: () => {
    Test.assert_error(() => tokens('(a "b\n")'), 'Invalid string literal: "b');
  },
  lexer_fails_on_mismatched_brace: () => {
    Test.assert_error(() => tokens('[)'), 'Unexpected close brace: )');
  },
  lexer_fails_on_unmatched_parentheses: () => {
    Test.assert_error(() => tokens('['), 'Unclosed brace: [');
  },
};

export {lexer};
