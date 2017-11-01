# Simple test of some English phrases.

@{% const lexer = require('../parsing/lexer'); %}

@enable_generation

@lexer {% new lexer.MooLexer({
  identifier: /[a-zA-Z_][a-zA-Z0-9_]*/,
  whitespace: {match: /\s+/, value: () => null},
  _: /./,
}) %}

# The main body of the grammar.

main -> "my" _ "name" _ "is" _ %identifier {% (= {name: $6}) %}

_ -> (null | _ %whitespace | _ %_)
