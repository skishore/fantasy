import {None, Option} from '../lib/base';
import {Action, Agent, Response} from './agent';
import {Defaults} from './registry';
import {Context, Field, Parse, Realize, Semantics} from './types';

const NoContext = (): Context => ({prompted: None, unprompted: []});

const c = Defaults.check;

const build_context = (last: Context, semantics: Semantics[]): Context => {
  const result = NoContext();
  const fields: {[key: string]: true} = {};
  const insert = (field: Field<any>, prompted: boolean) => {
    if (!!fields[key(field)]) return;
    fields[key(field)] = true;
    if (prompted) {
      result.prompted = {some: field};
    } else {
      result.unprompted.push(field);
    }
  }
  semantics.map((x) => c.RequestField(x)).filter((x) => x && x.field)
           .forEach((x) => insert(x!.field, /*prompted=*/true));
  const last_prompted = last.prompted;
  if (last_prompted) insert(last_prompted.some, /*prompted=*/false);
  last.unprompted.map((x) => insert(x, /*prompted=*/false));
  return result;
};

const filter = (responses: Response[]): Response[] => {
  const map: {[index: string]: Response[]} = {};
  responses.forEach((x) => {
    map[x.action] = map[x.action] || [];
    map[x.action].push(x);
  });
  const [ask, bye, say]: Action[] = ['ask', 'hang-up', 'say'];
  if (!!map[bye]) return [map[bye][0]];
  return (map[say] || []).concat(!!map[ask] ? [map[ask][0]] : []);
}

const key = (field: Field<any>): string => `${field.frame}.${field.slot}`;

class Runner {
  private agent: Agent<any>;
  private parse: Parse;
  private realize: Realize;
  private context: Context;
  constructor(agent: Agent<any>, parse: Parse, realize: Realize) {
    this.agent = agent;
    this.parse = parse;
    this.realize = realize;
    this.context = NoContext();
  }
  process(utterance: string) {
    const value = {matched: false, updated: false};
    const semantics = this.parse(this.context, utterance);
    semantics.forEach((x) => {
      const signals = this.agent.process({type: 'utterance', value: x});
      value.matched = value.matched || signals.matched;
      value.updated = value.updated || signals.updated;
    });
    this.agent.process({type: 'signals', value});
  }
  respond(): string {
    const proposed = this.agent.respond();
    const filtered = filter(proposed);
    filtered.forEach(
        (x) => this.agent.process({type: 'response', value: x}));
    const semantics = filtered.map((x) => x.semantics);
    this.context = build_context(this.context, semantics);
    return this.realize(semantics);
  }
}

export {Runner};
