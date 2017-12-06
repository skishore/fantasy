/* tslint:disable:no-console */
declare const process: any;
declare const require: any;
const readline = require('readline');

import {core} from './core';
import {Registry} from './registry';
import {Runner} from './runner';
import {Context, Field, Semantics, Types} from './types';

// Here starts the implementation of a language-independent agent.

const registry = Registry<{}>()({
  Demo: {around: Types.boolean, name: Types.string},
});
const {f, u} = {f: registry.fields, u: registry.utterances};

const agent = core.Do((x) => {
  const name = x.bind(core.RequestField(f.Demo.name));
  if (name.toLowerCase() === 'jeff') {
    x.bind(core.RequestField(f.Demo.around));
  }
});

// Here's the implementation of said agent's parser and realizer.

type Regex = [RegExp, (matches: string[]) => Semantics];

const parse = (context: Context, utterance: string): Semantics[] => {
  utterance = utterance.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, ' ')
                       .replace(/\s{2,}/g, ' ')
                       .toLowerCase().trim();
  const regexes: Regex[] = [
    [/.*(call me|name is|name's) (.*)/, (xs) => u.Demo({name: xs[2]})],
  ];
  const set = (field: Field<any>, value: any): Semantics => {
    return (<any>u)[field.frame]({[field.slot]: value});
  }
  const add = (field: Field<any>, prompted: boolean) => {
    if (field.type === 'boolean') {
      regexes.push([/.*(okay|sure|yeah|yes).*/, () => set(field, true)]);
      regexes.push([/.*(don't|nah|no).*/, () => set(field, false)]);
    } else if (field.type === 'string') {
      regexes.push([/.*(is|it's) (.*)/, (xs) => set(field, xs[2])]);
      if (prompted) {
        regexes.push([/(.*)/, (xs) => set(field, xs[1])]);
      }
    }
  }
  const m_prompted = context.prompted;
  if (m_prompted) add(m_prompted.some, /*prompted=*/true);
  context.unprompted.map((x) => add(x, /*prompted=*/false));
  for (const regex of regexes) {
    const match = regex[0].exec(utterance);
    if (match) return [regex[1](match)];
  }
  return [];
}

const realize = registry.realize({
  AcknowledgeField: ({field, value}) => {
    if (field.slot === 'around') {
      if (value) {
        return [`Alright, I'll see you there.`, `Awesome, see you soon!`];
      } else {
        return [`Okay. Let me know if you change your mind.`];
      }
    } else if (field.slot === 'name') {
      return [`Hello, ${value}.`, `Hey, ${value}.`, `Hi, ${value}.`];
    }
    return [''];
  },
  RequestField: ({count, field}) => {
    if (count === 2) {
      return [`Answer the question!`, `I don't get it.`, `Huh?`, `What?`];
    } else if (count > 2) {
      return [`...`, `Okay...`, `Huh...`];
    }
    if (field.slot === 'around') {
      return [`Want to come visit Facebook when I'm there next week?`,
              `Will you be around next week when I'm in Menlo Park?`];
    } else if (field.slot === 'name') {
      return [`What's your name?`, `Hey, who are you?`];
    }
    return [''];
  },
})((xs: string[]) => xs.join(' '));

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
