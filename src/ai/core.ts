// In this file, we define some primitive agents that can be used along with
// the "Do" framework to build up complex behavior.

import {Option, clone} from '../lib/base';
import {Agent, Response, Semantics, Signals, Uid, Update} from './agent';

type Reduce<T> = (value: T, update: Update) => Option<T>;

const Ask = (frame: string, value: any) => Respond({frame, value}, 'ask');

const Block = (): Agent<null> => Agent();

const Hear = (frame: string): Agent<any> => {
  let value: Option<any> = null;
  return Agent({
    process: (update) => {
      if (update.type !== 'heard' || update.semantics.frame !== frame) {
        return {matched: false, updated: false};
      }
      value = {some: update.semantics.value};
      return {matched: true, updated: true};
    },
    respond: () => [{type: 'listen', frame}],
    value: () => clone(value),
  });
}

const Match = (): Agent<null> => State(null, (value, update) =>
    update.type === 'processed' && update.signals.matched ?
    {some: {some: null}} : null);

const NoMatch = (): Agent<null> => State(null, (value, update) =>
    update.type === 'processed' && !update.signals.matched ?
    {some: {some: null}} : null);

const Optional = <T>(agent: Agent<T>): Agent<Option<T>> => {
  const value = (): Option<Option<T>> => ({some: agent.value()});
  return {...agent, value};
}

const Respond = (semantics: Semantics, type: 'ask' | 'say'): Agent<null> => {
  let responded = false;
  const uid = Uid();
  return Agent({
    process: (update) => {
      const matched = update.type === 'spoke' && update.uid === uid;
      responded = responded || matched;
      return {matched, updated: matched};
    },
    respond: () => responded ? [] : [clone({semantics, type, uid})],
    value: () => responded ? {some: null} : null,
  });
}

const State = <T>(initial: Option<T>, fn: Reduce<Option<T>>): Agent<T> => {
  let maybe_value = initial;
  return Agent({
    process: (update) => {
      const result = fn(clone(maybe_value), update);
      if (!result) return {matched: false, updated: false};
      maybe_value = result.some;
      return {matched: true, updated: true};
    },
    value: () => clone(maybe_value),
  });
}

const Say = (frame: string, value: any) => Respond({frame, value}, 'say');

const WaitOneTurn = (): Agent<null> => State(null, (value, update) =>
    update.type === 'processed' && !value ?
    {some: {some: null}} : null);

// Finally, we define a type-safe mechanism for using the agents above.
// Clients define a "frame" type S mapping frame names to their value types,
// and then call register<S>() to get a registry of agent primitives.

interface Registry<S> {
  Ask: <T extends keyof S>(frame: T, value: S[T]) => Agent<null>,
  Block: () => Agent<null>,
  Hear: <T extends keyof S>(frame: T) => Agent<S[T]>,
  Match: () => Agent<null>,
  NoMatch: () => Agent<null>,
  Optional: <T>(agent: Agent<T>) => Agent<Option<T>>,
  Say: <T extends keyof S>(frame: T, value: S[T]) => Agent<null>,
  WaitOneTurn: () => Agent<null>,
};

const registry = {
  Ask,
  Block,
  Hear,
  Match,
  NoMatch,
  Optional,
  Say,
  WaitOneTurn,
};

const register = <S>(): Registry<S> => registry;

export {register};
