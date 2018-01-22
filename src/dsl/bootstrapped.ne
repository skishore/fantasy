# Self-hosted grammar describing grammar files.

@{% const lexer = require('../parsing/lexer'); %}

@lexer {% new lexer.MooLexer({
  block: {match: /{%[^]*?[%]}/, value: (x) => x.slice(2, -2).trim()},
  comment: {match: /#.*$/, value: () => null},
  keyword: {match: 'null', value: () => null},
  identifier: /[a-zA-Z_][a-zA-Z0-9_]*/,
  string: lexer.MooLexer.string,
  whitespace: {match: /\s+/, value: () => null},
  _: /./,
}) %}

list_whitespace[X] -> $X (_ $X):* {% (d) => [d[0]].concat(d[1].map((x) => x[1])) %}

list[X, Y] -> $X (_ $Y _ $X):* {% (d) => [d[0]].concat(d[1].map((x) => x[3])) %}

# The main body of the grammar.

main -> _ items _  {% (d) => d[1] %}

items -> list_whitespace[item] {% (d) => d[0] %}

item -> "@" _ %block {% (d) => ({type: 'block', block: d[2]}) %}
      | "@" "lexer" _ %block {% (d) => ({type: 'lexer', lexer: d[3]}) %}
      | word "[" words "]" _ "-" ">" _ rules {% (d) => ({type: 'macro', name: d[0], rules: d[8], args: d[2]}) %}
      | word _ "-" ">" _ rules  {% (d) => ({type: 'rules', name: d[0], rules: d[5]}) %}

rules -> list[rule, "|"] {% (d) => d[0] %}

rule -> exprs {% (d) => ({exprs: d[0]}) %}
      | exprs _ %block {% (d) => ({exprs: d[0], transform: d[2]}) %}

exprs -> list_whitespace[expr] {% (d) => d[0] %}
       | %keyword {% (d) => [] %}

expr -> "$" word {% (d) => ({type: 'binding', name: d[1]}) %}
      | word "[" list[arg, ","] "]" {% (d) => ({type: 'macro', args: d[2], name: d[0]}) %}
      | expr _ ":" _ modifier {% (d) => ({type: 'modifier', base: d[0], modifier: d[4]}) %}
      | "(" _ rules _ ")" {% (d) => ({type: 'subexpression', rules: d[2]}) %}
      | term {% (d) => ({type: 'term', term: d[0]}) %}

arg -> "$" word {% (d) => ({type: 'binding', name: d[1]}) %}
     | term {% (d) => ({type: 'term', term: d[0]}) %}

term -> word {% (d) => d[0] %}
      | %string {% (d) => ({text: d[0]}) %}
      | "%" word {% (d) => ({type: d[1]}) %}

modifier -> ("?" | "*" | "+") {% (d) => d[0][0] %}

words -> list[word, ","] {% (d) => d[0] %}

word -> %identifier {% (d) => d[0] %}

_ -> (null | _ %comment | _ %whitespace) {% (d) => null %}
