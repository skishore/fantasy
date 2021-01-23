/* tslint:disable:no-console */
declare const process: any;
declare const require: any;
const readline = require('readline');

import {sample} from '../lib/base';
import {Semantics} from './agent';
import {register} from './core';
import {Do} from './do';
import {Runner} from './runner';

// Here starts the implementation of a language-independent agent.

const {Ask, Hear, Match, Optional, Say, WaitOneTurn} = register<{
  'hello': null;
  'my_name_is_$': string,
  'nice_to_meet_you_$': string,
  'whats_your_name': number,
}>();

const agent = Do(({bind}) => {
  bind(Say('hello', null));
  const maybe_name = bind(Optional(Hear('my_name_is_$')));
  while (!maybe_name) {
    bind(Optional(Match()));
    for (let count = 0; ; count++) {
      bind(Ask('whats_your_name', count));
      bind(WaitOneTurn());
    }
  }
  bind(Say('nice_to_meet_you_$', maybe_name.some));
});

// Here's the implementation of said agent's parser and realizer.

type Regex = [RegExp, (matches: string[]) => Semantics];

const parse = (input: string): Semantics[] => {
  input = input.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, ' ')
               .replace(/\s{2,}/g, ' ')
               .toLowerCase().trim();
  const regexes: Regex[] = [[
    /.*(hi|hello).*/,
    (xs) => ({frame: 'hello', value: null}),
  ], [
    /.*(call me|name is|name's) (.*)/,
    (xs) => ({frame: 'my_name_is_$', value: xs[2]}),
  ]];
  for (const regex of regexes) {
    const match = regex[0].exec(input);
    if (match) return [regex[1](match)];
  }
  return [];
}

const realize = (semantics: Semantics[]): string => semantics.map((x) => {
  if (x.frame === 'hello') {
    return sample(['Hello!', 'Hey there!', 'Hi!']);
  } else if (x.frame === 'nice_to_meet_you_$') {
    return `Nice to meet you, ${x.value}!`;
  } else if (x.frame === 'whats_your_name') {
    return `For the ${x.value} time, what's your name?`;
  }
}).join(' ');

// Execute the agent above.

const runner = new Runner(agent, parse, realize);

const shell = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> ',
});

console.log(runner.respond());
shell.prompt();

shell.on('line', (line: string) => {
  runner.process(line);
  console.log(runner.respond());
  shell.prompt();
}).on('close', () => {
  console.log('Be seeing you...');
  process.exit(0);
});
