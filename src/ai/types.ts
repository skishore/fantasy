import {Option} from '../lib/base';

// Our system is built around frame-semantic parsing ala FrameNet.
interface Context {prompted: Option<Field<any>>, unprompted: Field<any>[]};
interface Parse {(context: Context, utterance: string): Semantics[]};
interface Realize {(semantics: Semantics[]): string};
interface Semantics {frame: string, slots: {[slot: string]: any}};

// A Field is a typed pointer into a particular slot in a particular frame.
interface Field<T> {frame: string, slot: string, type: Type};
type TaggedType<T> = string & {type: T};
type Type = keyof typeof Types;

const Types = {
  any: <TaggedType<any>>'any',
  boolean: <TaggedType<boolean>>'boolean',
  Date: <TaggedType<Date>>'Date',
  Field: <TaggedType<Field<any>>>'Field',
  number: <TaggedType<number>>'number',
  string: <TaggedType<string>>'string',
};

export {Context, Field, Parse, Realize, Semantics, Types};
