import {Option} from '../lib/base';
import {Agent, Response, Semantics, Uid} from './agent';

interface Parse {(input: string): Semantics[]};
interface Realize {(semantics: Semantics[]): string};

interface Speech {semantics: Semantics, type: 'ask' | 'say', uid: Uid};

const select = (responses: Response[]): Speech[] => {
  let ask: Speech | null = null;
  const selected: Speech[] = [];
  responses.forEach((x) => {
    if (x.type === 'ask' && !ask) ask = x;
    if (x.type === 'say') selected.push(x);
  });
  if (ask) selected.push(ask);
  return selected;
}

class Runner {
  private agent: Agent<any>;
  private parse: Parse;
  private realize: Realize;
  constructor(agent: Agent<any>, parse: Parse, realize: Realize) {
    this.agent = agent;
    this.parse = parse;
    this.realize = realize;
  }
  process(utterance: string) {
    const semantics = this.parse(utterance);
    const signals = {matched: false, updated: false};
    semantics.forEach((x) => {
      const result = this.agent.process({type: 'heard', semantics: x});
      signals.matched = signals.matched || result.matched;
      signals.updated = signals.updated || result.updated;
    });
    this.agent.process({type: 'processed', signals});
  }
  respond(): string {
    let last_count = -1;
    let selected: Speech[] = [];
    const recorded: {[uid: number]: boolean} = {};
    while (selected.length > last_count) {
      last_count = selected.length;
      const proposed = this.agent.respond();
      selected = select((<Response[]>selected).concat(proposed));
      selected.forEach((x) => {
        if (recorded[x.uid]) return;
        recorded[x.uid] = true;
        this.agent.process({type: 'spoke', uid: x.uid});
      });
    }
    return this.realize(selected.map((x) => x.semantics));
  }
}

export {Runner};
