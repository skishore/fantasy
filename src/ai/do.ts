import {Option, assert, clone, flatten} from '../lib/base';
import {Agent, Response, Signals, Update} from './agent';

// Our type-safe "Do" agent framework is based on the treating agents as a
// monad with "bind", "fork", and "join" methods. "Do" takes a "Block<T>",
// a function that may call these helper methods and that ultimately returns
// a value of type T, and converts it into an Agent<T>.
//
// Within a do block, these methods have the following types:
//
//   bind: Agent<T> -> T
//   fork: Block<T> -> Child<T>
//   join: Child<T> -> T
//
// Note that these types are different from the usual definition of the bind
// method in a monad! This inconsistency is because this library uses vanilla
// Typescript syntax to emulate Haskell syntax sugar. In particular, a given
// do block will be run many times, with a structure determined by where calls
// to the methods above appear:
//
//   - Each time a call to "bind" is executed, the rest of the block is placed
//     in the context of the bound agent. If the agent already has a value,
//     the rest of the block is executed right away; otherwise, the agent is
//     captured and the remaining logic is deferred until it has a value.
//
//   - Each time a call to "fork" is executed, it block starts execution in a
//     subcontext of the current context. Because this block still has access
//     to the parent context, children from the parent context can be joined.
//
//   - "join" works the same way as "bind", but on the output of a previous
//     call to fork instead of an agent itself.
//
// One other wrinkle in do-block behavior is the "replay" aspect. All bound
// agents and children in a do-block are stored in the runner's memory. If a
// bound agent processes user input, then any logic downstream of that binding
// is replayed from scratch with the new value. The same is true of any bound
// child if the value of its fork block changes.

interface Block<T> {(root: Root): T};

interface Child<T> {depth: number, index: number};

interface Root {
  bind: <T>(agent: Agent<T>) => T,
  fork: <T>(block: Agent<T> | Block<T>) => Child<T>,
  join: <T>(child: Block<T> | Child<T>) => T,
}

// Internal types used to maintain state of the do-block runner.

type Event =
  {type: 'bind', value: Agent<any>} |
  {type: 'fork', value: State<any>} |
  {type: 'join', value: Child<any>};

type State<T> = {events: Event[], value: Option<T>};

const State = <T>(): State<T> => ({events: [], value: null});

// During the processing of an individual update, we will track a stack
// representing our current execution context. Each element in the stack is
// of type Context, storing which event index call it should replay from,
// the current execution state, and which events were touched by the update.

interface Context {index: number, signals: Signals[], state: State<any>};

class Deferred extends Error {
  constructor() { super(); (<any>this).deferred = true; }
};

// Given a bind, fork, or join event, tries to look up its state in context.
// If the event was previous executed, this method returns its old value;
// otherwise, it adds the event the context and returns its new value.
const replay = <T>(context: Context, event: Event & {value: T}): T => {
  assert(context.index === context.signals.length);
  const saved = context.state.events[context.index++];
  if (saved) {
    assert(saved.type === event.type);
    return <T><any>saved.value;
  }
  context.state.events.push(event);
  return event.value;
}

// Collects all responses from a given do-block state.
const respond = (state: State<any>): Response[] => {
  const responses = state.events.map((event) => {
    if (event.type === 'bind') return event.value.respond();
    if (event.type === 'fork') return respond(event.value);
    return [];
  });
  return flatten(responses);
}

const typeguard = <U>(value: any): value is Block<U> => {
  return typeof value === 'function';
};

const Do = <T>(block: Block<T>): Agent<T> => {
  const state = State<T>();
  const stack: Context[] = [];
  let context = <Context><any>null;
  let current: Update | null = null;

  const bind = <U>(agent: Agent<U>): U => {
    const saved = replay(context, {type: 'bind', value: agent});
    context.signals.push(current ? saved.process(current) :
                         {matched: false, updated: false});
    if (context.signals[context.index - 1].updated) {
      context.state.events.length = context.index;
    }
    const value = saved.value();
    if (!!value) return value.some;
    throw new Deferred();
  }

  const fork = <U>(block: Agent<U> | Block<U>): Child<U> => {
    if (!typeguard(block)) return fork(() => bind(block));
    const saved = replay(context, {type: 'fork', value: State<U>()});
    context.signals.push(run(block, saved, current));
    return {depth: stack.length - 1, index: context.index - 1};
  }

  const join = <U>(child: Block<U> | Child<U>): U => {
    if (typeguard(child)) return join(fork(child));
    const saved = replay(context, {type: 'join', value: child});
    assert(saved.depth === child.depth && saved.index === child.index);
    assert(saved.depth < stack.length);
    assert(saved.index < stack[saved.depth].state.events.length);
    context.signals.push(stack[saved.depth].signals[saved.index]);
    if (context.signals[context.index - 1].updated) {
      context.state.events.length = context.index;
    }
    const event = stack[saved.depth].state.events[saved.index];
    if (event.type !== 'fork') {
      throw Error(`Invalid join: ${JSON.stringify(saved)}`);
    }
    const value = event.value.value;
    if (!!value) return value.some;
    throw new Deferred();
  }

  const root: Root = {bind, fork, join};

  // Runs a given block with a given state context. Returns true if any block
  // element processed the latest update (incluing binds, forks, and joins).
  const run = <T>(block: Block<T>, state: State<T>,
                  update: Update | null): Signals => {
    assert(!context || context.index === context.signals.length + 1);
    context = {index: 0, signals: [], state};
    current = update || null;
    stack.push(context);
    try {
      state.value = {some: block(root)};
    } catch (error) {
      if (!error.deferred) throw error;
      state.value = null;
    }
    stack.pop();
    assert(context.index === context.signals.length);
    const matched = context.signals.some((x) => x.matched);
    const updated = context.signals.some(
        (x, i) => x.updated && context.state.events[i].type !== 'fork');
    context = stack[stack.length - 1] || null;
    return {matched, updated};
  }

  run(block, state, null);

  return {
    process: (update) => run(block, state, update),
    respond: () => respond(state),
    value: () => clone(state.value),
  };
};

export {Do};
