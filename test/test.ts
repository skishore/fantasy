/* tslint:disable:no-console */
import {assert, debug} from '../src/lib/base';

interface Test {[name: string]: () => Promise<void> | void};

const assert_eq = <T>(a: T, b: T): void => {
  if (a instanceof Error) throw a;
  if (b instanceof Error) throw b;
  assert(check_eq(a, b), () => print_error('assert_eq', debug(a), debug(b)));
}

const assert_error = (fn: () => any, message: string): void => {
  try {
    fn();
  } catch (error) {
    assert(error instanceof Error, () => print_error(
        'assert_error', debug(error), 'Error'));
    assert(('' + error).indexOf(message) >= 0, () => print_error(
        'assert_error', error, `Error containing ${debug(message)}`));
    return;
  }
  assert(false, () => print_error(
      'assert_error', 'success', `Error containing ${debug(message)}`));
}

const check_eq = <T>(a: T, b: T): boolean => {
  if (!a || !b) {
    return a === b;
  } else if (a instanceof Array || b instanceof Array) {
    if (!(a instanceof Array && b instanceof Array)) return false;
    return a.length === b.length && a.every((x, i) => check_eq(x, b[i]));
  } else if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set && b instanceof Set)) return false;
    return check_eq(Array.from(a).sort(), Array.from(b).sort());
  } else if (typeof a === 'object' && typeof b === 'object') {
    if (!check_eq(Object.keys(a).sort(), Object.keys(b).sort())) return false;
    return Object.keys(a).every((x) => check_eq((<any>a)[x], (<any>b)[x]));
  } else {
    return a === b;
  }
}

const print_error = (name: string, a: any, b: any): string => {
  const br = '\n      ';
  return `${name} failed:${br}  Actual: ${a}${br}Expected: ${b}`;
}

// Returns a Unix status code: 0 for success, 1 for failure.
async function run(tests: {[module: string]: Test}): Promise<number> {
  const modules = Object.keys(tests).sort();
  const total = modules.reduce(
      ((sum, x) => sum + Object.keys(tests[x]).length), 0);
  const failures: {full: string, name: string, error: Error}[] = [];
  console.log(`\nRunning ${total} tests:\n`)
  for (const module of modules) {
    const test = tests[module];
    for (const name in test) {
      if (!test.hasOwnProperty(name)) continue;
      const full = `${module}.${name}`;
      try {
        const promise = test[name]();
        if (promise) await promise;
        console.log(`${full} ... \x1b[32mok\x1b[0m`);
      } catch(error) {
        console.log(`${full} ... \x1b[31mFAILED\x1b[0m`);
        failures.push({full, name, error});
      }
    }
  }

  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const failure of failures) {
      const stack = failure.error.stack || '';
      const index = stack.indexOf(failure.name);
      const end = index >= 0 ? stack.indexOf('\n', index) : stack.length;
      const length = end >= 0 ? end - 7 : stack.length - 7;
      console.log(`\n---- ${failure.full} ----\n `, stack.substr(7, length));
    }
  }

  const result = ['\nResult: '];
  if (failures.length === 0) {
    result.push('\x1b[32mok\x1b[0m');
  } else {
    result.push('\x1b[31mFAILED\x1b[0m');
  }
  const passed = total - failures.length;
  result.push(`. ${passed} passed; ${failures.length} failed.\n`);
  console.log(result.join(''));
  return failures.length === 0 ? 0 : 1;
}

const Test = {assert_eq, assert_error, run}

export {Test};
