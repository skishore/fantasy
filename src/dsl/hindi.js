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
  {lhs: "main", rhs: ["_", "subject", "_", "verb_phrase", "_"], transform: new template.Template("{subject: $1, predicate: $3}",[false,false,false,false,false])},
  {lhs: "adjective_phrase", rhs: ["maybe_adjective_phrase", {type: "adjective"}], transform: new template.Template("[...$0, $1]",[false,false])},
  {lhs: "maybe_adjective_phrase", rhs: ["adjective_phrase", "_"], transform: new template.Template("$0",[false,false])},
  {lhs: "maybe_adjective_phrase", rhs: []},
  {lhs: "maybe_determiner", rhs: [{type: "determiner"}, "_"], transform: new template.Template("$0",[false,false])},
  {lhs: "maybe_determiner", rhs: []},
  {lhs: "noun_direct", rhs: [{type: "noun_direct_singular"}], transform: new template.Template("{count: \"singular\", noun: $0}",[false])},
  {lhs: "noun_direct", rhs: [{type: "noun_direct_plural"}], transform: new template.Template("{count: \"plural\", noun: $0}",[false]), score: -0.1},
  {lhs: "noun_direct", rhs: [{type: "noun_oblique_singular"}], transform: new template.Template("{count: \"singular\", noun: $0}",[false]), score: -0.2},
  {lhs: "noun_direct", rhs: [{type: "noun_oblique_plural"}], transform: new template.Template("{count: \"plural\", noun: $0}",[false]), score: -0.3},
  {lhs: "noun_oblique", rhs: [{type: "noun_oblique_singular"}], transform: new template.Template("{count: \"singular\", noun: $0}",[false])},
  {lhs: "noun_oblique", rhs: [{type: "noun_oblique_plural"}], transform: new template.Template("{count: \"plural\", noun: $0}",[false]), score: -0.1},
  {lhs: "noun_oblique", rhs: [{type: "noun_direct_singular"}], transform: new template.Template("{count: \"singular\", noun: $0}",[false]), score: -0.2},
  {lhs: "noun_oblique", rhs: [{type: "noun_direct_plural"}], transform: new template.Template("{count: \"plural\", noun: $0}",[false]), score: -0.3},
  {lhs: "object$macro$1", rhs: ["maybe_determiner", "maybe_adjective_phrase", "noun_oblique"], transform: new template.Template("{determiner: $0, modifiers: $1, ...$2}",[false,false,false]), syntaxes: [{"indices":[2,0,1],"tense":{}}]},
  {lhs: "object$macro$1", rhs: ["maybe_determiner", {type: "number"}, "_", "maybe_adjective_phrase", {type: "noun"}], transform: new template.Template("{count: $1, determiner: $0, modifiers: $3, noun: $4}",[false,false,false,false,false]), syntaxes: [{"indices":[1,4,0,3],"tense":{}}, {"indices":[2],"tense":{}}]},
  {lhs: "object", rhs: ["object$macro$1"], transform: new template.Template("$0",[false]), syntaxes: [{"indices":[0],"tense":{"case":"oblique","person":"third"}}]},
  {lhs: "object", rhs: [{type: "pronoun"}], transform: new template.Template("{pronoun: $0}",[false])},
  {lhs: "subject$macro$1", rhs: ["maybe_determiner", "maybe_adjective_phrase", "noun_direct"], transform: new template.Template("{determiner: $0, modifiers: $1, ...$2}",[false,false,false]), syntaxes: [{"indices":[2,0,1],"tense":{}}]},
  {lhs: "subject$macro$1", rhs: ["maybe_determiner", {type: "number"}, "_", "maybe_adjective_phrase", {type: "noun"}], transform: new template.Template("{count: $1, determiner: $0, modifiers: $3, noun: $4}",[false,false,false,false,false]), syntaxes: [{"indices":[1,4,0,3],"tense":{}}, {"indices":[2],"tense":{}}]},
  {lhs: "subject", rhs: ["subject$macro$1"], transform: new template.Template("$0",[false]), syntaxes: [{"indices":[0],"tense":{"case":"direct","person":"third"}}]},
  {lhs: "subject", rhs: [{type: "pronoun"}], transform: new template.Template("{pronoun: $0}",[false])},
  {lhs: "verb_phrase", rhs: ["object", "_", {type: "copula"}], transform: new template.Template("{verb: \"be\", object: $0}",[false,false,false]), syntaxes: [{"indices":[2],"tense":{}}, {"indices":[0],"tense":{}}, {"indices":[1],"tense":{}}]},
  {lhs: "verb_phrase", rhs: ["adjective_phrase", "_", {type: "copula"}], transform: new template.Template("{verb: \"be\", object: $0}",[false,false,false])},
  {lhs: "_", rhs: []},
  {lhs: "_", rhs: ["_", {type: "_"}]},
  {lhs: "_", rhs: ["s", {type: "token"}, "s"], score: -10},
  {lhs: "s", rhs: []},
  {lhs: "s", rhs: ["s", {type: "_"}]},
];
exports.start = "main";
exports.templated = true;
