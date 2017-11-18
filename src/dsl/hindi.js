"use strict";

Object.defineProperty(exports, "__esModule", { value: true });

const template = require('../lib/template');

const builtin_base_cases = {
  '?': new template.Template('[]', []),
  '*': new template.Template('[]', []),
  '+': new template.Template('[$0]', [false]),
};
const builtin_recursives = {
  '?': new template.Template('$0', [false]),
  '*': new template.Template('[...$0, $1]', [true, false]),
  '+': new template.Template('[...$0, $1]', [false, false]),
};

const lexer = require('../parsing/lexer');

exports.lexer = new lexer.MooLexer({
  identifier: /[a-zA-Z_][a-zA-Z0-9_]*/,
  whitespace: {match: /\s+/, value: () => null},
  _: /./,
});

exports.rules = [
  {lhs: "main", rhs: ["noun_phrase"], transform: new template.Template("$0",[false])},
  {lhs: "noun_phrase$modifier$1", rhs: [], transform: builtin_base_cases["?"], score: 0},
  {lhs: "noun_phrase$modifier$1", rhs: ["PT_determiner"], transform: builtin_recursives["?"], score: 0},
  {lhs: "noun_phrase$modifier$2", rhs: [], transform: builtin_base_cases["?"], score: 0},
  {lhs: "noun_phrase$modifier$2", rhs: ["PT_count"], transform: builtin_recursives["?"], score: 0},
  {lhs: "noun_phrase", rhs: ["noun_phrase$modifier$1", "_", "noun_phrase$modifier$2", "_", "adjective_phrase", "_", "PT_noun"], transform: new template.Template("{count: $2, determiner: $0, modifiers: $4, noun: $6}",[true,false,true,false,false,false,false])},
  {lhs: "adjective_phrase", rhs: ["adjective_phrase", "_", "PT_adjective"], transform: new template.Template("[...$0, $2]",[false,false,false])},
  {lhs: "adjective_phrase", rhs: ["PT_adjective"], transform: new template.Template("[$0]",[false])},
  {lhs: "_$subexpression$1", rhs: []},
  {lhs: "_$subexpression$1", rhs: ["_", {type: "whitespace"}]},
  {lhs: "_$subexpression$1", rhs: ["_", {type: "_"}]},
  {lhs: "_", rhs: ["_$subexpression$1"]},
  {lhs: "PT_adjective", rhs: [{text: "bare"}], transform: new template.Template("\"large\"",[false])},
  {lhs: "PT_adjective", rhs: [{text: "baree"}], transform: new template.Template("\"large\"",[false])},
  {lhs: "PT_adjective", rhs: [{text: "cote"}], transform: new template.Template("\"small\"",[false])},
  {lhs: "PT_adjective", rhs: [{text: "cotee"}], transform: new template.Template("\"small\"",[false])},
  {lhs: "PT_count", rhs: [{text: "ek"}], transform: new template.Template("1",[false])},
  {lhs: "PT_count", rhs: [{text: "do"}], transform: new template.Template("2",[false])},
  {lhs: "PT_count", rhs: [{text: "teen"}], transform: new template.Template("3",[false])},
  {lhs: "PT_count", rhs: [{text: "caar"}], transform: new template.Template("4",[false])},
  {lhs: "PT_determiner", rhs: [{text: "voh"}], transform: new template.Template("\"that\"",[false])},
  {lhs: "PT_determiner", rhs: [{text: "yeh"}], transform: new template.Template("\"this\"",[false])},
  {lhs: "PT_noun", rhs: [{text: "aadmee"}], transform: new template.Template("\"man\"",[false])},
  {lhs: "PT_noun", rhs: [{text: "aurat"}], transform: new template.Template("\"woman\"",[false])},
  {lhs: "PT_noun", rhs: [{text: "larka"}], transform: new template.Template("\"boy\"",[false])},
  {lhs: "PT_noun", rhs: [{text: "larki"}], transform: new template.Template("\"girl\"",[false])},
];

exports.start = "main";
