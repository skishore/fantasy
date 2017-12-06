import {None, assert} from '../lib/base';
import {Field, Realize, Semantics, Types} from './types';

interface Frames {[frames: string]: SlotTypes};
interface SlotTypes {[slot: string]: {type: any}};
type Slots<T extends SlotTypes> = {[K in keyof T]: T[K]['type']};

// A small list of reflective responses that all registries support.
type Base = {[F in keyof typeof Base]: Slots<(typeof Base)[F]>};
const Base = {
  AcknowledgeField: {field: Types.Field, value: Types.any},
  RequestField: {count: Types.number, field: Types.any},
};

// We build a registration system that allows us to construct frame semantics
// in a type-safe way by registering response and utterance frames.
const Registry = (() => {
  // Any registry includes several maps, all type-safe and keyed by frame:
  //
  //   - The "check" map allows us to check whether a given semantics matches
  //     a given utterance type and returns its typed slots if it does.
  //
  //   - The "fields" map allows us to refer to a particular field in the
  //     registry and automatically infers that field's type.
  //
  //   - The "realize" function allows us to build a type-safe realize method
  //     that handles all registered response semantics.
  //
  //   - The "responses" map allows us to build response semantics given that
  //     we have all slots required to fill a given response frame.
  //
  //   - The "utterances" map allows us to build utterance semantics given
  //     that we have some subset of slots needed for a given utterance frame.
  //
  type Check<T extends Frames> =
      {[F in keyof T]: (semantics: Semantics) => Partial<Slots<T[F]>> | None};
  type Fields<T extends Frames> =
      {[F in keyof T]: {[S in keyof T[F]]: Field<T[F][S]['type']>}};
  type Realizer<T> =
      (map: {[F in keyof (Base & T)]: (fn: (Base & T)[F]) => string[]}) =>
      (join: (values: string[]) => string) => Realize;
  type Responses<T> =
      {[F in keyof (Base & T)]: (slots: (Base & T)[F]) => Semantics};
  type Utterances<T extends Frames> =
      {[F in keyof T]: (slots?: Partial<Slots<T[F]>>) => Semantics};

  interface Registry<R, U extends Frames> {
    check: Check<U>,
    fields: Fields<U>,
    realize: Realizer<R>,
    responses: Responses<R>,
    utterances: Utterances<U>,
  };

  return <R>() => <U extends Frames>(utterances: U): Registry<R,U> => {
    const semantics = (frame: string) =>
        (slots?: any): Semantics => ({frame, slots: slots || {}});
    const handler = {get: (_: any, frame: string) => semantics(frame)};
    const result: Registry<R,U> = <any>{check: {}, fields: {}, utterances: {}};
    result.realize = (map) => (reduce) => (semantics: Semantics[]) => {
      // TODO(skishore): Handle errors here by returning Result<string>.
      const realize = (semantics: Semantics): string => {
        const options = map[<any>semantics.frame](semantics.slots);
        if (options.length === 0) {
          throw new Error(`Failed to realize: ${JSON.stringify(semantics)}`);
        }
        return options[Math.floor(Math.random() * options.length)];
      }
      return reduce(semantics.map((x) => realize(x)).filter((x) => !!x));
    }
    result.responses = new Proxy({}, handler);
    for (const frame in utterances) {
      if (!utterances.hasOwnProperty(frame)) continue;
      result.check[frame] = (semantics: Semantics) =>
          semantics.frame === frame ? <any>semantics.slots : None;
      result.fields[frame] = <any>{};
      result.utterances[frame] = semantics(frame);
      for (const slot in utterances[frame]) {
        if (!utterances[frame].hasOwnProperty(slot)) continue;
        const type = <any>utterances[frame][slot];
        result.fields[frame][slot] = {frame, slot, type};
      }
    }
    return result;
  }
})();

const Defaults = Registry<Base>()(Base);

export {Defaults, Registry};
