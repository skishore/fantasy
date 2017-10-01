interface Grammar {
  Lexer: any,
  ParserRules: Rule[],
  ParserStart: string,
}

interface Rule {
  name: string,
  postprocess: (d: any[]) => any,
  symbols: (string | {literal: string})[],
}

const detect_nullable_names = (grammar: Grammar): string[] => {
  let last_size = -1;
  const nullable = new Set<string>();
  const visit = (y: any) => typeof y === 'string' && nullable.has(y);
  while (nullable.size > last_size) {
    last_size = nullable.size;
    grammar.ParserRules.filter(x => x.symbols.every(visit))
                       .forEach(x => nullable.add(x.name));
  }
  return Array.from(nullable).sort();
}

const detect_reachable_names = (grammar: Grammar): string[] => {
  let last_size = -1;
  const reachable = new Set([grammar.ParserStart]);
  const visit = (y: any) => typeof y === 'string' ? reachable.add(y) : 0;
  while (reachable.size > last_size) {
    last_size = reachable.size;
    grammar.ParserRules.filter(x => reachable.has(x.name))
                       .forEach(x => x.symbols.forEach(visit));
  }
  return Array.from(reachable);
}

const prune_unreachable_rules = (grammar: Grammar): Grammar => {
  const reachable = new Set(detect_reachable_names(grammar));
  const rules = grammar.ParserRules.filter((x) => reachable.has(x.name));
  return Object.assign({}, grammar, {ParserRules: rules});
}

declare const require: any;
const grammar: Grammar = require('../../dsl/value_template');
console.log(prune_unreachable_rules(grammar).ParserRules.length);

const {Parser} = require('nearley');
console.log(Parser);

export {prune_unreachable_rules};
