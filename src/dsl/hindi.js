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
  {lhs: "main", rhs: ["_", "noun_phrase", "_"], transform: new template.Template("$1",[false,false,false]), syntaxes: [{"indices":[1],"tense":{"case":"direct"}}]},
  {lhs: "noun_phrase$modifier$1", rhs: [], transform: builtin_base_cases["?"], score: 0},
  {lhs: "noun_phrase$modifier$1", rhs: [{type: "determiner"}], transform: builtin_recursives["?"], score: 0},
  {lhs: "noun_phrase$modifier$2", rhs: [], transform: builtin_base_cases["?"], score: 0},
  {lhs: "noun_phrase$modifier$2", rhs: ["adjective_phrase"], transform: builtin_recursives["?"], score: 0},
  {lhs: "noun_phrase", rhs: ["noun_phrase$modifier$1", "_", "noun_phrase$modifier$2", "_", {type: "noun"}], transform: new template.Template("{determiner: $0, modifiers: $2, noun: $4}",[true,false,true,false,false]), syntaxes: [{"indices":[4,0,2],"tense":{}}]},
  {lhs: "adjective_phrase", rhs: ["adjective_phrase", "_", {type: "adjective"}], transform: new template.Template("[...$0, $2]",[false,false,false])},
  {lhs: "adjective_phrase", rhs: [{type: "adjective"}], transform: new template.Template("[$0]",[false])},
  {lhs: "_", rhs: ["_", {type: "token"}], score: -1},
  {lhs: "_$subexpression$1", rhs: []},
  {lhs: "_$subexpression$1", rhs: ["_", {type: "_"}]},
  {lhs: "_", rhs: ["_$subexpression$1"]},
];
exports.start = "main";
exports.templated = true;
