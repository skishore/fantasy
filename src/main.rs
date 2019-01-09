#![feature(test)]

#[cfg(test)]
extern crate combine;
extern crate test;

use std::collections::BTreeSet;
use std::rc::Rc;
use test::Bencher;

struct State<'a> {
  expected: Vec<Rc<String>>,
  input: &'a [u8],
  remainder: usize,
}

type Output<'a, T> = Option<(T, &'a [u8])>;

type Method<'a, T> = Fn(&'a [u8], &mut State<'a>) -> Output<'a, T> + 'a;

pub struct Parser<'a, T> {
  method: Box<Method<'a, T>>,
}

impl<'a, T> Parser<'a, T> {
  pub fn new<M>(method: M) -> Parser<'a, T>
  where
    M: Fn(&'a [u8], &mut State<'a>) -> Output<'a, T> + 'a,
  {
    Parser { method: Box::new(method) }
  }

  pub fn parse(&self, x: &'a str) -> Result<T, String> {
    let input = x.as_bytes();
    let mut state = State { expected: vec![], input, remainder: input.len() };
    match (self.method)(input, &mut state) {
      Some((value, x)) => {
        if x.len() > 0 {
          Result::Err(format(Some(x.len()), &mut state))
        } else {
          Ok(value)
        }
      }
      None => Result::Err(format(None, &mut state)),
    }
  }
}

fn format<'a>(remainder: Option<usize>, state: &mut State<'a>) -> String {
  if let Some(remainder) = remainder {
    update(Rc::new("EOF".to_string()), remainder, state);
  }
  let expected: BTreeSet<_> = state.expected.iter().map(|x| x.to_string()).collect();
  let expected: Vec<_> = expected.into_iter().collect();
  let index = state.input.len() - state.remainder;
  format!("At index {}: expected: {}", index, expected.join(" | "))
}

fn update<'a>(expected: Rc<String>, remainder: usize, state: &mut State<'a>) {
  if state.remainder < remainder {
    return;
  } else if state.remainder > remainder {
    state.expected.clear();
    state.remainder = remainder;
  }
  state.expected.push(expected);
}

fn any<'a, A: 'a>(parsers: Vec<Parser<'a, A>>) -> Parser<'a, A> {
  Parser::new(move |x, s| {
    for parser in &parsers {
      match (parser.method)(x, s) {
        Some(x) => return Some(x),
        None => continue,
      }
    }
    None
  })
}

fn map<'a, A: 'a, B: 'a, F>(parser: Parser<'a, A>, callback: F) -> Parser<'a, B>
where
  F: Fn(A) -> B + 'a,
{
  Parser::new(move |x, s| match (parser.method)(x, s) {
    Some((value, x)) => Some((callback(value), x)),
    None => None,
  })
}

fn mul<'a, A: 'a>(parser: Parser<'a, A>, min: usize) -> Parser<'a, Vec<A>> {
  Parser::new(move |x, s| {
    let mut remainder = x;
    let mut result = vec![];
    loop {
      match (parser.method)(remainder, s) {
        Some((value, x)) => {
          remainder = x;
          result.push(value);
        }
        None => break,
      }
    }
    if result.len() < min {
      None
    } else {
      Some((result, remainder))
    }
  })
}

fn opt<'a, A: 'a>(a: Parser<'a, A>) -> Parser<'a, Option<A>> {
  Parser::new(move |x, s| match (a.method)(x, s) {
    Some((value, x)) => Some((Some(value), x)),
    None => Some((None, x)),
  })
}

fn seq2<'a, A: 'a, B: 'a>(a: Parser<'a, A>, b: Parser<'a, B>) -> Parser<'a, (A, B)> {
  Parser::new(move |x, s| {
    if let Some((a, x)) = (a.method)(x, s) {
      if let Some((b, x)) = (b.method)(x, s) {
        return Some(((a, b), x));
      }
    }
    None
  })
}

fn seq3<'a, A: 'a, B: 'a, C: 'a>(
  a: Parser<'a, A>,
  b: Parser<'a, B>,
  c: Parser<'a, C>,
) -> Parser<'a, (A, B, C)> {
  Parser::new(move |x, s| {
    if let Some((a, x)) = (a.method)(x, s) {
      if let Some((b, x)) = (b.method)(x, s) {
        if let Some((c, x)) = (c.method)(x, s) {
          return Some(((a, b, c), x));
        }
      }
    }
    None
  })
}

fn seq4<'a, A: 'a, B: 'a, C: 'a, D: 'a>(
  a: Parser<'a, A>,
  b: Parser<'a, B>,
  c: Parser<'a, C>,
  d: Parser<'a, D>,
) -> Parser<'a, (A, B, C, D)> {
  Parser::new(move |x, s| {
    if let Some((a, x)) = (a.method)(x, s) {
      if let Some((b, x)) = (b.method)(x, s) {
        if let Some((c, x)) = (c.method)(x, s) {
          if let Some((d, x)) = (d.method)(x, s) {
            return Some(((a, b, c, d), x));
          }
        }
      }
    }
    None
  })
}

fn tag<'a>(tag: &'a str) -> Parser<'a, &'a str> {
  let expected = Rc::new(format!("{:?}", tag));
  Parser::new(move |x, s| {
    if x.iter().take(tag.len()).eq(tag.as_bytes().iter()) {
      Some((tag, &x[tag.len()..]))
    } else {
      update(expected.clone(), x.len(), s);
      None
    }
  })
}

fn predicate<'a, F>(callback: F, name: &str) -> Parser<'a, u8>
where
  F: Fn(u8) -> bool + 'a,
{
  let expected = Rc::new(format!("{:?}", name));
  Parser::new(move |x, s| {
    if x.len() > 0 && callback(x[0]) {
      Some((x[0], &x[1..]))
    } else {
      update(expected.clone(), x.len(), s);
      None
    }
  })
}

fn digit(x: u8) -> bool {
  b'0' <= x && x <= b'9'
}

fn exponent(x: u8) -> bool {
  x == b'e' || x == b'E'
}

#[cfg(test)]
mod tests {
  use super::*;
  use combine::ParseResult;

  const TEST_STR: &'static str = "1.2345e67";

  #[bench]
  fn float_parser(b: &mut Bencher) {
    let digits1 = mul(predicate(digit, "digit"), 1);
    let digits2 = mul(predicate(digit, "digit"), 1);
    let digits3 = mul(predicate(digit, "digit"), 1);
    let parser = seq4(
      opt(tag("-")),
      any(vec![tag("0"), map(digits1, |_| "")]),
      opt(seq2(tag("."), digits2)),
      opt(seq2(predicate(exponent, "exponent"), digits3)),
    );
    assert_eq!(
      parser.parse(TEST_STR),
      Result::Ok((None, "", Some((".", vec![50, 51, 52, 53])), Some((101, vec![54, 55]))))
    );
    b.iter(|| parser.parse("1.2345e56"));
  }

  fn my_number(s: &[u8]) -> ParseResult<(), &[u8]> {
    use combine::*;
    use combine::range::take_while1;
    (
      token(b'-').map(Some).or(value(None)),
      token(b'0').map(|_| &b"0"[..]).or(take_while1(digit)),
      optional((token(b'.'), take_while1(digit))),
      optional((
        token(b'e').or(token(b'E')),
        token(b'-').map(Some).or(token(b'+').map(Some)).or(value(None)),
        take_while1(digit),
      )),
    )
      .map(|_| ())
      .parse_stream(s)
  }

  #[bench]
  fn bench_combine(b: &mut Bencher) {
    use combine::parser;
    use combine::Parser;
    assert_eq!(parser(my_number).parse(TEST_STR.as_bytes()), Ok(((), &b""[..])));
    b.iter(|| parser(my_number).parse(test::black_box(TEST_STR.as_bytes())))
  }
}

fn main() {}
