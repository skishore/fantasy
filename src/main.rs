#![feature(test)]

#[cfg(test)]
extern crate test;

use std::collections::BTreeSet;
use std::rc::Rc;
use test::Bencher;

struct Failure {
  expected: Vec<Rc<String>>,
  remainder: usize,
  total: usize,
}

type Output<'a, T> = Option<(T, &'a [u8])>;

type Method<'a, T> = Fn(&'a [u8], &mut Failure) -> Output<'a, T> + 'a;

pub struct Parser<'a, T> {
  method: Box<Method<'a, T>>,
}

impl<'a, T> Parser<'a, T> {
  pub fn new<M>(method: M) -> Parser<'a, T>
  where
    M: Fn(&'a [u8], &mut Failure) -> Output<'a, T> + 'a,
  {
    Parser { method: Box::new(method) }
  }

  pub fn parse(&self, x: &'a str) -> Result<T, String> {
    let total = x.len();
    let mut failure = Failure { expected: vec![], remainder: total, total };
    match (self.method)(x.as_bytes(), &mut failure) {
      Some((value, remainder)) => {
        if remainder.len() > 0 {
          Result::Err(format(&failure, remainder.len()))
        } else {
          Ok(value)
        }
      }
      None => Result::Err(format(&failure, total)),
    }
  }
}

fn format(failure: &Failure, remainder: usize) -> String {
  if failure.remainder > remainder {
    return format!("At index {}: expected: EOF", failure.total - remainder);
  }
  let expected: BTreeSet<_> = failure.expected.iter().map(|x| x.to_string()).collect();
  let expected: Vec<_> = expected.into_iter().collect();
  format!("At index {}: expected: {}", failure.total - failure.remainder, expected.join(" | "))
}

fn update(expected: Rc<String>, remainder: usize, failure: &mut Failure) {
  if failure.remainder < remainder {
    return;
  } else if failure.remainder > remainder {
    failure.expected.clear();
    failure.remainder = remainder;
  }
  failure.expected.push(expected);
}

fn any<'a, A: 'a>(parsers: Vec<Parser<'a, A>>) -> Parser<'a, A> {
  Parser::new(move |x, f| {
    for parser in &parsers {
      match (parser.method)(x, f) {
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
  Parser::new(move |x, f| match (parser.method)(x, f) {
    Some((value, x)) => Some((callback(value), x)),
    None => None,
  })
}

fn mul<'a, A: 'a>(parser: Parser<'a, A>, min: usize) -> Parser<'a, Vec<A>> {
  Parser::new(move |x, f| {
    let mut remainder = x;
    let mut result = vec![];
    loop {
      match (parser.method)(remainder, f) {
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
  Parser::new(move |x, f| match (a.method)(x, f) {
    Some((value, x)) => Some((Some(value), x)),
    None => Some((None, x)),
  })
}

fn seq<'a, A: 'a, B: 'a>(a: Parser<'a, A>, b: Parser<'a, B>) -> Parser<'a, (A, B)> {
  Parser::new(move |x, f| {
    (a.method)(x, f).map(|(a, x)| (b.method)(x, f).map(|(b, x)| ((a, b), x))).unwrap_or(None)
  })
}

fn tag<'a>(tag: &'a str) -> Parser<'a, &'a str> {
  let expected = Rc::new(format!("{:?}", tag));
  Parser::new(move |x, f| {
    if x.iter().take(tag.len()).eq(tag.as_bytes().iter()) {
      Some((tag, &x[tag.len()..]))
    } else {
      update(expected.clone(), x.len(), f);
      None
    }
  })
}

fn predicate<'a, F>(callback: F, name: &str) -> Parser<'a, u8>
where
  F: Fn(u8) -> bool + 'a,
{
  let expected = Rc::new(format!("{:?}", name));
  Parser::new(move |x, f| {
    if x.len() > 0 && callback(x[0]) {
      Some((x[0], &x[1..]))
    } else {
      update(expected.clone(), x.len(), f);
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

  #[bench]
  fn float_parser(b: &mut Bencher) {
    let digits1 = mul(predicate(digit, "digit"), 1);
    let digits2 = mul(predicate(digit, "digit"), 1);
    let digits3 = mul(predicate(digit, "digit"), 1);
    let parser = seq(
      seq(opt(tag("-")), any(vec![tag("0"), map(digits1, |_| "")])),
      seq(opt(seq(tag("."), digits2)), opt(seq(predicate(exponent, "exponent"), digits3))),
    );
    assert_eq!(
      parser.parse("1.2345e56"),
      Result::Ok(((None, ""), (Some((".", vec![50, 51, 52, 53])), Some((101, vec![53, 54])))))
    );
    b.iter(|| parser.parse("1.2345e56"));
  }
}

fn main() {}
