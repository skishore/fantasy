// This file contains core types used to define the agent AI system.

import {None, Option, Uid} from '../lib/base';
import {Semantics} from './types';

type Action = 'ask' | 'hang-up' | 'say';
interface Response {action: Action, semantics: Semantics, uid: Uid}

interface Signals {matched: boolean, updated: boolean};

type Update =
  {type: 'utterance', value: Semantics} |
  {type: 'response', value: Response} |
  {type: 'signals', value: Signals};

interface Agent<T> {
  process: (update: Update) => Signals,
  respond: () => Response[],
  value: () => Option<T>,
};

const Agent = <T>(extra?: Partial<Agent<T>>): Agent<T> => {
  const agent: Agent<T> = {
    process: (update) => ({matched: false, updated: false}),
    respond: () => [],
    value: () => None,
  };
  return extra ? Object.assign(agent, extra) : agent;
}

export {Action, Agent, Response, Signals, Update};
