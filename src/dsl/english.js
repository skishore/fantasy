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
  {lhs: "main", rhs: [{text: "my"}, "_", {text: "name"}, "_", {text: "is"}, "_", {type: "identifier"}], transform: new template.Template("{name: $6}",[false,false,false,false,false,false,false])},
  {lhs: "_$subexpression$1", rhs: []},
  {lhs: "_$subexpression$1", rhs: ["_", {type: "whitespace"}]},
  {lhs: "_$subexpression$1", rhs: ["_", {type: "_"}]},
  {lhs: "_", rhs: ["_$subexpression$1"]},
];

exports.start = "main";
