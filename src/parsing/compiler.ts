import {assert, clone} from '../lib/base';
import {Grammar, Term} from './grammar';
import {Parser} from './parser';

// The output of the bootstrapped grammar is a list of ItemNode values.

type ArgNode =
  {type: 'binding', name: string} |
  {type: 'term', term: Term};

type ItemNode =
  {type: 'block', block: string} |
  {type: 'lexer', lexer: string} |
  {type: 'macro', name: string, rules: RuleNode[], args: string[]} |
  {type: 'rules', name: string, rules: RuleNode[]};

type RuleNode = {exprs: ExprNode[], transform?: string};

type ExprNode =
  {type: 'binding', name: string} |
  {type: 'macro', args: ArgNode[], name: string} |
  {type: 'modifier', base: ExprNode, modifier: Modifier} |
  {type: 'subexpression', rules: RuleNode[]} |
  {type: 'term', term: Term};

type Modifier = '?' | '*' | '+';

// This compiler converts those items into the CompiledGrammar output format,
// using an Environment to keep track of assigned symbols and bound variables.

interface CompiledGrammar {
  blocks: string[];
  lexer?: string;
  rules: CompiledRule[];
  start?: string;
}

interface CompiledRule {
  lhs: string;
  rhs: Term[];
  score?: number,
  transform?: string,
}

interface Environment {
  bindings: {[name: string]: Term};
  counts: {[name: string]: number};
  macros: {[name: string]: {args: string[], rules: RuleNode[]}};
  result: CompiledGrammar;
}

// Some basic transforms used for rules with modifiers ('?' | '*' | '+').

const kPrelude = `
const builtin_base_cases = {
  '?': (d) => null,
  '*': (d) => d,
  '+': (d) => d,
};
const builtin_recursives = {
  '?': (d) => d[0],
  '*': (d) => d[0].concat([d[1]]),
  '+': (d) => d[0].concat([d[1]]),
};
  `;

// The core compiler logic is a series of operations on the env state.

const add_rules = (lhs: string, rule: RuleNode, env: Environment): void => {
  const rhs = rule.exprs.map((x, i) => build_term(lhs, x, env));
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

const build_macro = (lhs: string, args: ArgNode[], name: string,
                     env: Environment): Term => {
  const symbol = add_symbol(lhs, 'macro', env);
  const macro = env.macros[name];
  if (!macro) throw new Error(`Unbound macro: ${name}`);
  const n = macro.args.length;
  if (args.length !== n) {
    throw new Error(`${name} got ${args.length} argments; expected: ${n}`);
  }
  const child: Environment = {...env, bindings: {...env.bindings}};
  args.forEach((x, i) => {
    const term = x.type === 'binding' ? build_binding(x.name, env) : x.term;
    child.bindings[macro.args[i]] = term;
  });
  macro.rules.forEach((x) => add_rules(symbol, x, child));
  return symbol;
}

const build_modifier = (lhs: string, base: ExprNode, modifier: Modifier,
                        env: Environment): Term => {
  const symbol = add_symbol(lhs, 'modifier', env);
  const term: ExprNode = {type: 'term', term: symbol};
  const rules: RuleNode[] =
      modifier === '?' ? [{exprs: []}, {exprs: [base]}] :
      modifier === '*' ? [{exprs: []}, {exprs: [term, base]}] :
      modifier === '+' ? [{exprs: [base]}, {exprs: [term, base]}] : [];
  assert(rules.length === 2, () => `Invalid modifier: ${modifier}`);
  rules[0].transform = `builtin_base_cases['${modifier}']`;
  rules[1].transform = `builtin_recursives['${modifier}']`;
  rules.forEach((x) => add_rules(symbol, x, env));
  return symbol;
}

const build_subexpression = (lhs: string, rules: RuleNode[],
                             env: Environment): Term => {
  const symbol = add_symbol(lhs, 'subexpression', env);
  rules.forEach((x) => add_rules(symbol, x, env));
  return symbol;
}

const build_term = (lhs: string, expr: ExprNode, env: Environment): Term => {
  switch (expr.type) {
    case 'binding': return build_binding(expr.name, env);
    case 'macro': return build_macro(lhs, expr.args, expr.name, env);
    case 'modifier': return build_modifier(lhs, expr.base, expr.modifier, env);
    case 'subexpression': return build_subexpression(lhs, expr.rules, env);
    case 'term': return expr.term;
  }
}

const evaluate = (items: ItemNode[]): CompiledGrammar => {
  const result = {blocks: [kPrelude], rules: []};
  const env = {bindings: {}, counts: {}, macros: {}, result};
  items.forEach((x) => evaluate_item(x, env));
  return result;
}

const evaluate_item = (item: ItemNode, env: Environment): void => {
  switch (item.type) {
    case 'block': env.result.blocks.push(item.block); break;
    case 'lexer': env.result.lexer = item.lexer; break;
    case 'macro': env.macros[item.name] = item; break;
    case 'rules':
      if (!env.result.start) env.result.start = item.name;
      return item.rules.forEach((x) => add_rules(item.name, x, env));
  }
}

const generate = (grammar: CompiledGrammar): string => {
  if (!grammar.lexer) {
    grammar = clone(grammar);
    grammar.blocks.unshift(`const lexer = require('../parsing/lexer');`);
    grammar.lexer = 'new lexer.CharacterLexer()';
  }
  return `
"use strict";

Object.defineProperty(exports, "__esModule", { value: true });

${grammar.blocks.map((x) => x.trim()).join('\n\n')}

exports.lexer = ${grammar.lexer.trim()};
exports.rules = [
  ${grammar.rules.map(generate_rule).join(',\n  ')},
];
exports.start = ${JSON.stringify(grammar.start)};
  `.trim() + '\n';
}

const generate_rule = (rule: CompiledRule): string => {
  const rhs = `[${rule.rhs.map(generate_term).join(', ')}]`;
  const suffixes = [
    rule.score ? `, score: ${rule.score}` : '',
    rule.transform ? `, transform: ${rule.transform}` : '',
  ];
  return `{lhs: ${JSON.stringify(rule.lhs)}, rhs: ${rhs}${suffixes.join('')}}`;
}

const generate_term = (term: Term): string => {
  if (typeof term === 'string') {
    return JSON.stringify(term);
  } else if ((<any>term).text) {
    return `{text: ${JSON.stringify((<any>term).text)}}`;
  } else if ((<any>term).type) {
    return `{type: ${JSON.stringify((<any>term).type)}}`;
  }
  throw Error(`Unexpected term: ${JSON.stringify(term)}`);
}

const validate = (grammar: CompiledGrammar): CompiledGrammar => {
  if (!grammar.start) throw Error(`No grammar start term!`);
  const lhs = new Set<string>();
  const rhs = new Set<string>([grammar.start]);
  grammar.rules.forEach((x) => {
    lhs.add(x.lhs);
    x.rhs.forEach((y) => { if (typeof y === 'string') rhs.add(y); });
  });
  const dead_end = Array.from(rhs).filter((x) => !lhs.has(x)).sort();
  const unreachable = Array.from(lhs).filter((x) => !rhs.has(x)).sort();
  if (dead_end.length > 0) {
    throw Error(`Found dead-end symbols: ${dead_end.join(', ')}`);
  } else if (unreachable.length > 0) {
    throw Error(`Found unreachable symbols: ${unreachable.join(', ')}`);
  }
  return grammar;
}

// The public compiler interface - for now, a single pure function.

class Compiler {
  static compile(input: string): string {
    const grammar = Grammar.from_file('../dsl/bootstrapped');
    const ast = Parser.parse(grammar, input).value!.some;
    return Compiler.generate(evaluate(ast));
  }
  static generate(grammar: CompiledGrammar): string {
    return generate(validate(grammar));
  }
}

export {CompiledGrammar, CompiledRule, Compiler};
