// This file contains basic primitives that can be used along with the "Do"
// framework to build up complex agents..

import {None, Option, Uid, assert, clone} from '../lib/base';
import {Action, Agent, Response, Update} from './agent';
import {Do} from './do';
import {Defaults} from './registry';
import {Field, Semantics} from './types';

type Reduce<T> = (value: T, update: Update) => Option<T>;

const r = Defaults.responses;

const Respond = (response: Response): Agent<None> => {
  let responded = false;
  return Agent({
    process: (update) => {
      const matched = update.type === 'response' &&
                      update.value.uid === response.uid;
      responded = responded || matched;
      return {matched, updated: matched};
    },
    respond: () => responded ? [] : [clone(response)],
    value: () => responded ? {some: None} : None,
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

// Finally, we define some higher-level agents that are built using the Do
// framework and the primitives above to accomplish some common subtask.

const Ask = (semantics: Semantics): Agent<None> =>
    Respond({action: 'ask', semantics, uid: Uid()});

const GetField = <T>(field: Field<T>): Agent<T> =>
  State<T>(None, (value, update) => {
    if (update.type !== 'utterance') return None;
    if (update.value.frame !== field.frame) return None;
    return update.value.slots.hasOwnProperty(field.slot) ?
           {some: {some: update.value.slots[field.slot]}} : None;
  });

const HangUp = (semantics: Semantics): Agent<None> =>
    Respond({action: 'hang-up', semantics, uid: Uid()});

const Optional = <T>(agent: Agent<T>): Agent<Option<T>> => {
  const value = (): Option<Option<T>> => ({some: agent.value()});
  return Object.assign({}, agent, {value});
}

const RequestField = <T>(field: Field<T>): Agent<T> => Do((x) => {
  const m_value = x.bind(Optional(GetField(field)));
  while (!m_value) {
    x.bind(Optional(WaitForMatch()));
    for (let count = 0; ; count++) {
      x.bind(Ask(r.RequestField({count, field})));
      x.bind(WaitOneTurn());
    }
  }
  x.fork(Say(r.AcknowledgeField({field, value: m_value.some})));
  return m_value.some;
});

const Say = (semantics: Semantics): Agent<None> =>
    Respond({action: 'say', semantics, uid: Uid()});

const Wait = (): Agent<None> => Agent();

const WaitForMatch = (): Agent<None> =>
    State(None, (value, update) =>
        update.type === 'signals' && update.value.matched ?
        {some: {some: None}} : None);

const WaitOneTurn = (): Agent<None> =>
    State(None, (value, update) =>
        update.type === 'signals' && !value ?
        {some: {some: None}} : None);

const core = {
  Ask,
  Do,
  GetField,
  HangUp,
  Optional,
  RequestField,
  Say,
  Wait,
  WaitForMatch,
  WaitOneTurn,
};

export {core};
