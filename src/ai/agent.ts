import {Option} from '../lib/base';

// A simple uid generation framework.

type Uid = number & {uid: true};

const Uid: () => Uid = (() => { let uid = 0; return () => <Uid>uid++; })();

// The core agent types.

interface Agent<T> {
  process: (update: Update) => Signals,
  respond: () => Response[],
  value: () => Option<T>,
};

type Response =
  {type: 'ask' | 'say', semantics: Semantics, uid: Uid} |
  {type: 'listen', frame: string};

interface Semantics {frame: string, value: any};

type Signals = {matched: boolean, updated: boolean};

type Update =
  {type: 'heard', semantics: Semantics} |
  {type: 'processed', signals: Signals} |
  {type: 'spoke', uid: Uid};

// A helper used to instantiate agents.

const Agent = <T>(extra?: Partial<Agent<T>>): Agent<T> => {
  return {
    process: (update) => ({matched: false, updated: false}),
    respond: () => [],
    value: () => null,
    ...extra,
  };
}

export {Agent, Response, Semantics, Signals, Update, Uid};
