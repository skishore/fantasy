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

const include = require('../hindi/include');

exports.lexer = include.lexer;
exports.rules = [
  {lhs: "main", rhs: ["_", "subject", "_"], transform: new template.Template("$1",[false,false,false])},
  {lhs: "noun_direct", rhs: [{type: "noun_direct_singular"}], transform: new template.Template("{count: \"singular\", noun: $0}",[false])},
  {lhs: "noun_direct", rhs: [{type: "noun_direct_plural"}], transform: new template.Template("{count: \"plural\", noun: $0}",[false]), score: -0.1},
  {lhs: "noun_direct", rhs: [{type: "noun_oblique_singular"}], transform: new template.Template("{count: \"singular\", noun: $0}",[false]), score: -0.2},
  {lhs: "noun_direct", rhs: [{type: "noun_oblique_plural"}], transform: new template.Template("{count: \"plural\", noun: $0}",[false]), score: -0.3},
  {lhs: "subject$macro$1$modifier$1", rhs: [], transform: builtin_base_cases["?"], score: 0},
  {lhs: "subject$macro$1$modifier$1", rhs: [{type: "determiner"}], transform: builtin_recursives["?"], score: 0},
  {lhs: "subject$macro$1$modifier$2", rhs: [], transform: builtin_base_cases["?"], score: 0},
  {lhs: "subject$macro$1$modifier$2", rhs: ["adjective_phrase"], transform: builtin_recursives["?"], score: 0},
  {lhs: "subject$macro$1", rhs: ["subject$macro$1$modifier$1", "_", "subject$macro$1$modifier$2", "_", "noun_direct"], transform: new template.Template("{determiner: $0, modifiers: $2, ...$4}",[true,false,true,false,false]), syntaxes: [{"indices":[4,0,2],"tense":{}}]},
  {lhs: "subject$macro$1$modifier$3", rhs: [], transform: builtin_base_cases["?"], score: 0},
  {lhs: "subject$macro$1$modifier$3", rhs: [{type: "determiner"}], transform: builtin_recursives["?"], score: 0},
  {lhs: "subject$macro$1$modifier$4", rhs: [], transform: builtin_base_cases["?"], score: 0},
  {lhs: "subject$macro$1$modifier$4", rhs: ["adjective_phrase"], transform: builtin_recursives["?"], score: 0},
  {lhs: "subject$macro$1", rhs: ["subject$macro$1$modifier$3", "_", {type: "number"}, "_", "subject$macro$1$modifier$4", "_", {type: "noun"}], transform: new template.Template("{count: $2, determiner: $0, modifiers: $4, noun: $6}",[true,false,false,false,true,false,false]), syntaxes: [{"indices":[2,6,0,4],"tense":{}}]},
  {lhs: "subject", rhs: ["subject$macro$1"], transform: new template.Template("$0",[false]), syntaxes: [{"indices":[0],"tense":{"case":"direct"}}]},
  {lhs: "adjective_phrase", rhs: ["adjective_phrase", "_", {type: "adjective"}], transform: new template.Template("[...$0, $2]",[false,false,false])},
  {lhs: "adjective_phrase", rhs: [{type: "adjective"}], transform: new template.Template("[$0]",[false])},
  {lhs: "_", rhs: []},
  {lhs: "_", rhs: ["_", {type: "_"}]},
  {lhs: "_", rhs: ["s", {type: "token"}, "s"], score: -10},
  {lhs: "s", rhs: []},
  {lhs: "s", rhs: ["s", {type: "_"}]},
];
exports.start = "main";
exports.templated = true;
