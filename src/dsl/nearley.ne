# Self-hosted grammar describing grammar files.

@{% const lexer = require('../../target/nearley/lexer'); %}

@lexer {% new lexer.MooLexer({
  block: {match: /{%[^]*?[%]}/, value: (x) => x.slice(2, -2).trim()},
  comment: {match: /#.*$/, value: (x) => null},
  keyword: {match: 'null', value: () => null},
  identifier: /[a-zA-Z_][a-zA-Z0-9_]*/,
  string: lexer.MooLexer.string,
  whitespace: {match: /\s+/, value: () => null},
  _: /./,
}) %}

list_whitespace[X] -> $X (_ $X):* {% (d) => d[0].concat(d[1].map((x) => x[1][0])) %}

list[X, Y] -> $X (_ $Y _ $X):* {% (d) => d[0].concat(d[1].map((x) => x[3][0])) %}

# The main body of the grammar.

main -> _ items _  {% (d) => d[1] %}

items -> list_whitespace[item] {% (d) => d[0] %}

item -> "@" _ %block {% (d) => ({type: 'block', block: d[2]}) %}
      | "@" "lexer" _ %block {% (d) => ({type: 'lexer', lexer: d[3]}) %}
      | word "[" words "]" _ "-" ">" _ rules {% (d) => ({type: 'macro', name: d[0], rules: d[8], args: d[2]}) %}
      | word _ "-" ">" _ rules  {% (d) => ({type: 'rules', name: d[0], rules: d[5]}) %}

rules -> list[rule, "|"] {% (d) => d[0] %}

rule -> terms {% (d) => ({terms: d[0]}) %}
      | terms  _ %block {% (d) => ({terms: d[0], transform: d[2]}) %}

terms -> list_whitespace[term] {% (d) => d[0] %}
       | %keyword {% (d) => [] %}

term -> "$" word {% (d) => ({type: 'binding', name: d[1]}) %}
      | word "[" args "]" {% (d) => ({type: 'macro', name: d[0], args: d[2]}) %}
      | term _ ":" _ modifier {% (d) => ({type: 'modifier', base: d[0], modifier: d[4]}) %}
      | "(" _ rules _ ")" {% (d) => ({type: 'subexpression', rules: d[2]}) %}
      | word {% (d) => ({type: 'symbol', symbol: d[0]}) %}
      | %string {% (d) => ({type: 'token_text', token_text: d[0]}) %}
      | "%" word {% (d) => ({type: 'token_type', token_type: d[1]}) %}

args -> list[rule, ","] {% (d) => d[0] %}

modifier -> ("?" | "*" | "+") {% (d) => d[0][0] %}

words -> list[word, ","] {% (d) => d[0] %}

word -> %identifier {% (d) => d[0] %}

_ -> (null | _ %comment | _ %whitespace) {% (d) => null %}
