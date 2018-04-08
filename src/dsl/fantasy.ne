# Self-hosted grammar describing grammar files.

@{% const lexer = require('../parsing/lexer'); %}

@lexer {% new lexer.MooLexer({
  block: {match: /{%[^]*?[%]}/, value: (x) => x.slice(2, -2).trim()},
  close: ')',
  comment: {match: /#.*$/, value: () => null},
  float: lexer.MooLexer.float,
  identifier: /[a-zA-Z_][a-zA-Z0-9_]*/,
  integer: lexer.MooLexer.integer,
  newline: '\n',
  string: lexer.MooLexer.string,
  whitespace: {match: /\s+/},
  _: /./,
}) %}

list[X, Y] -> $X ($Y $X):* {% (d) => [d[0]].concat(d[1].map((x) => x[1])) %}

# The main body of the grammar.

main -> _ list[item, b] _  {% (d) => d[1] %}

item -> '@' _ %block {% (d) => ({type: 'block', block: d[2]}) %}
      | '@' 'lexer' _ %block {% (d) => ({type: 'lexer', lexer: d[3]}) %}
      | lhs directives _ list[rhs, b] {% (d) => ({type: 'rule', rule: {directives: d[1], lhs: d[0], rhs: d[3]}}) %}

lhs -> word '[' list[word, c] ']' {% (d) => ({type: 'macro', name: d[0], args: d[2]}) %}
     | '.':? word {% (d) => ({type: 'symbol', name: d[1], root: !!d[0]}) %}

rhs -> s ' ' list[term, ' '] directives {% (d) => ({type: d[0], terms: d[2], directives: d[3]}) %}

# Helpers for building up rule RHS terms.

term -> expr '?':? m {% (d) => ({type: 'expr', expr: d[0], mark: d[2], optional: !!d[1]}) %}
      | %_ {% (d) => ({type: 'punctuation', punctuation: d[0]}) %}

expr -> '@' word {% (d) => ({type: 'binding', name: d[1]}) %}
      | word '[' list[expr, c] ']' {% (d) => ({type: 'macro', args: d[2], name: d[0]}) %}
      | '$' word {% (d) => ({type: 'term', term: d[1]}) %}
      | word {% (d) => ({type: 'term', term: {text: d[0]}}) %}
      | '%' word {% (d) => ({type: 'term', term: {type: d[1]}}) %}

word -> %identifier {% (d) => d[0] %}

# Helpers for building up directives, which add metadata to a rule.

directives -> (_ '(' directive ')'):* {% (d) => d[0].map((x) => x[2]) %}

directive -> '>' _ number {% (d) => ({type: 'score-gen', score: d[2]}) %}
           | '<' _ number {% (d) => ({type: 'score-par', score: d[2]}) %}
           | '=' token:+ {% (d) => ({type: 'template', template: d[1]}) %}

number -> (%float | %integer) {% (d) => d[0][0] %}

token -> %string {% (d) => JSON.stringify(d[0]) %}
       | (number | w | %identifier | %_) {% (d) => `${d[0][0]}` %}

# Trivial helpers for various terminals.

b -> _ '\n' _ {% (d) => null %}

c -> ',' ' ' {% (d) => null %}

m -> (null | '^' | '*') {% (d) => d[0][0] || '-' %}

s -> ('=' | '<' | '>') {% (d) => d[0][0] %}

w -> (%newline | %whitespace) {% (d) => d[0][0] %}

_ -> (null | _ %comment | _ w) {% (d) => null %}
