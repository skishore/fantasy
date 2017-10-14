type ItemNode =
  {type: 'block', block: string} |
  {type: 'lexer', lexer: string} |
  {type: 'macro', name: string, rules: RuleNode[], args: string[]} |
  {type: 'rules', name: string, rules: RuleNode[]};

type RuleNode = {terms: TermNode[], transform?: string};

type TermNode =
  {type: 'binding', name: string} |
  {type: 'macro', name: string, args: RuleNode[]} |
  {type: 'modifier', base: TermNode, modifier: '?' | '*' | '+'} |
  {type: 'subexpression', rules: RuleNode[]} |
  {type: 'symbol', symbol: string} |
  {type: 'token_text', token_text: string} |
  {type: 'token_type', token_type: string};

interface Grammar {
  blocks: string[];
  lexer?: string;
  rules: Rule[];
  start?: string;
}

interface Rule {
  lhs: string;
  rhs: Term[];
  transform?: string,
}

type Term = string | {text: string} | {type: string};

interface Environment {
  bindings: {[name: string]: string};
  counts: {[name: string]: number};
  macros: {[name: string]: {args: string[], rules: RuleNode[]}};
  result: Grammar;
}

const add_rules = (lhs: string, rule: RuleNode, env: Environment): void => {
  const rhs = rule.terms.map((x) => build_term(lhs, x, env));
  env.result.rules.push({lhs, rhs, transform: rule.transform});
}

const add_symbol = (lhs: string, suffix: string, env: Environment): string => {
  const name = `${lhs}$${suffix}`;
  const count = env.counts[name] = (env.counts[name] || 0) + 1;
  return `${name}$${count}`;
}

const build_binding = (name: string, env: Environment): Term => {
  if (!env.bindings[name]) throw new Error(`Unbound varibale: $${name}`);
  return env.bindings[name];
}

const build_macro = (lhs: string, args: RuleNode[], name: string,
                     env: Environment): Term => {
  const symbol = add_symbol(lhs, 'macro', env);
  const macro = env.macros[name];
  if (!macro) throw new Error(`Unbound macro: ${name}`);
  const n = macro.args.length;
  if (args.length !== n) {
    throw new Error(`${name} got ${args.length} argments; expected: ${n}`);
  }
  const bindings = Object.assign({}, env.bindings);
  const child = Object.assign({}, env, {bindings});
  for (let i = 0; i < n; i++) {
    const arg = add_symbol(symbol, 'arg', env);
    add_rules(arg, args[i], env);
    child.bindings[macro.args[i]] = arg;
  }
  macro.rules.forEach((x) => add_rules(symbol, x, child));
  return symbol;
}

const build_modifier = (lhs: string, modifier: '?' | '*' | '+',
                        term: TermNode, env: Environment): Term => {
  const rules: RuleNode[] = [];
  const symbol = add_symbol(lhs, 'modifier', env);
  const transform = '(d) => d[0].concat([d[1]])';
  if (modifier === '?') {
    rules.push({terms: [], transform: '(d) => null'});
    rules.push({terms: [term], transform: '(d) => d[0]'});
  } else if (modifier === '*') {
    rules.push({terms: []});
    rules.push({terms: [{type: 'symbol', symbol}, term], transform});
  } else if (modifier === '+') {
    rules.push({terms: [term]});
    rules.push({terms: [{type: 'symbol', symbol}, term], transform});
  }
  rules.forEach((x) => add_rules(symbol, x, env));
  return symbol;
}

const build_subexpression = (lhs: string, rules: RuleNode[],
                             env: Environment): Term => {
  const symbol = add_symbol(lhs, 'subexpression', env);
  rules.forEach((x) => add_rules(symbol, x, env));
  return symbol;
}

const build_term = (lhs: string, term: TermNode, env: Environment): Term => {
  switch (term.type) {
    case 'binding': return build_binding(term.name, env);
    case 'macro': return build_macro(lhs, term.args, term.name, env);
    case 'modifier': return build_modifier(lhs, term.modifier, term.base, env);
    case 'subexpression': return build_subexpression(lhs, term.rules, env);
    case 'symbol': return term.symbol;
    case 'token_text': return {text: term.token_text};
    case 'token_type': return {type: term.token_type};
  }
}

const evaluate = (items: ItemNode[]): Grammar => {
  const result = {blocks: [], rules: []};
  const env = {bindings: {}, counts: {}, macros: {}, result};
  items.forEach((x) => evaluate_item(x, env));
  return result;
}

const evaluate_item = (item: ItemNode, env: Environment): void => {
  if (item.type === 'block') {
    env.result.blocks.push(item.block);
  } else if (item.type === 'lexer') {
    env.result.lexer = item.lexer;
  } else if (item.type === 'macro') {
    env.macros[item.name] = {args: item.args, rules: item.rules};
  } else if (item.type === 'rules') {
    if (!env.result.start) env.result.start = item.name;
    item.rules.forEach((x) => add_rules(item.name, x, env));
  }
}

const generate = (grammar: Grammar): string => {
  grammar = JSON.parse(JSON.stringify(grammar));
  if (!grammar.start) throw Error(`No grammar start term!`);
  if (!grammar.lexer) {
    grammar.blocks.unshift(`const lexer = require('../src/nearley/lexer');`);
    grammar.lexer = 'new lexer.CharacterLexer()';
  }
  return `
"use strict";

Object.defineProperty(exports, "__esModule", { value: true });

${grammar.blocks.map((x) => x.trim()).join('\n')}

exports.grammar = {
  rules: [
    ${grammar.rules.map(generate_rule).join(',\n    ')},
  ],
  start: ${JSON.stringify(grammar.start)},
};
exports.lexer = ${grammar.lexer};`.trim();
}

const generate_rule = (rule: Rule): string => {
  const rhs = `[${rule.rhs.map(generate_term).join(', ')}]`;
  const transform = rule.transform ? `, transform: ${rule.transform}` : '';
  return `{lhs: ${JSON.stringify(rule.lhs)}, rhs: ${rhs}${transform}}`;
}

const generate_term = (term: Term): string => {
  if (typeof term === 'string') {
    return JSON.stringify(term);
  } else if ((<any>term).text) {
    return `{text: ${JSON.stringify((<any>term).text)}}`;
  } else if ((<any>term).type) {
    return `{type: ${JSON.stringify((<any>term).type)}}`;
  }
  throw Error(`Unexpected term: ${term}`);
}

// A quick test of the compiler.

declare const require: any;
const fs = require('fs');
const util = require('util');
const config = {colors: true, depth: null};
const debug = (x: any) => util.inspect(x, config);
fs.readFile('output.val', {encoding: 'utf8'}, (error: Error, data: string) => {
  const input: ItemNode[] = eval(data);
  console.log(generate(evaluate(input)));
});
