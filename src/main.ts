import {nonnull, RNG} from './lib/base';
import {Corrector} from './parsing/corrector';
import {Tree} from './parsing/extensions';
import {Fantasy} from './parsing/fantasy';
import {Generator} from './parsing/generator';
import {Parser} from './parsing/parser';
import {Lambda} from './template/lambda';

/* tslint:disable-next-line:no-any */
declare const process: any;
/* tslint:disable-next-line:no-any */
declare const require: any;
const fs = require('fs');
const input = fs.readFileSync('src/hindi/hindi.gr', 'utf8');
const grammar = Fantasy.parse(Lambda, input);

/* tslint:disable:no-console */
const last = process.argv[2];
const text = process.argv.slice(3).join(' ');
const generate = last === 'generate';
if (last !== 'generate' && last !== 'parse') {
  console.error('Usage: ./fantasy.ts [generate|parse]');
  process.exit(1);
}

const rng = new RNG();
const maybe = generate
  ? Generator.generate(grammar, rng, {some: Lambda.parse(text)})
  : Parser.parse(grammar, text, {debug: true});
if (!maybe) throw new Error(`Failed to ${last} input!`);
const tree = nonnull(maybe).some;
const result = Corrector.correct(grammar, rng, tree);

const print = <T>(tree: Tree<T>, script: string) =>
  Tree.matches(tree)
    .map(x => x.data.text[script])
    .join(' ');

const script = 'latin';
console.log(Tree.print(tree, script));
console.log();
console.log(Lambda.stringify(tree.value));
console.log();
console.log(`Start: ${print(tree, script)}`);
console.log(`Fixed: ${print(result.tree, script)}`);
result.diff.forEach(x => {
  if (x.type === 'right') return;
  const o = x.old.map(x => x.data.text[script]).join(' ');
  const n = x.new.map(x => x.data.text[script]).join(' ');
  console.log(`${o} -> ${n}:\n  ${x.errors.join('\n  ')}`);
});
