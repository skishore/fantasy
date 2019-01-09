#![feature(test)]

#[cfg(test)]
extern crate test;

use std::collections::BTreeSet;
use std::rc::Rc;
use test::Bencher;

type Failure = (Vec<Rc<String>>, usize);

type Output<T> = Option<(T, usize)>;

type Method<'a, T> = Fn(&'a [u8], usize, &mut Failure) -> Output<T> + 'a;

pub struct Parser<'a, T> {
  method: Box<Method<'a, T>>,
}

impl<'a, T> Parser<'a, T> {
  pub fn new<M>(method: M) -> Parser<'a, T>
  where
    M: Fn(&'a [u8], usize, &mut Failure) -> Output<T> + 'a,
  {
    Parser { method: Box::new(method) }
  }

  pub fn parse(&self, x: &'a str) -> Result<T, String> {
    let mut failure = (vec![], 0);
    match (self.method)(x.as_bytes(), 0, &mut failure) {
      Some((value, i)) => {
        if i < x.len() {
          Result::Err(format(&failure, i))
        } else {
          Ok(value)
        }
      }
      None => Result::Err(format(&failure, 0)),
    }
  }
}

fn format(failure: &Failure, i: usize) -> String {
  if failure.1 < i {
    return format!("At index {}: expected: EOF", i);
  }
  let expected: BTreeSet<_> = failure.0.iter().map(|x| x.to_string()).collect();
  let expected: Vec<_> = expected.into_iter().collect();
  format!("At index {}: expected: {}", failure.1, expected.join(" | "))
}

fn update(expected: Rc<String>, i: usize, failure: &mut Failure) {
  if i < failure.1 {
    return;
  } else if i > failure.1 {
    failure.0.clear();
    failure.1 = i;
  }
  failure.0.push(expected);
}

fn any<'a, A: 'a>(parsers: Vec<Parser<'a, A>>) -> Parser<'a, A> {
  Parser::new(move |x, i, f| {
    for parser in &parsers {
      match (parser.method)(x, i, f) {
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
  Parser::new(move |x, i, f| match (parser.method)(x, i, f) {
    Some((value, i)) => Some((callback(value), i)),
    None => None,
  })
}

fn mul<'a, A: 'a>(parser: Parser<'a, A>, min: usize) -> Parser<'a, Vec<A>> {
  Parser::new(move |x, i, f| {
    let mut position = i;
    let mut result = vec![];
    loop {
      match (parser.method)(x, position, f) {
        Some((value, i)) => {
          position = i;
          result.push(value);
        }
        None => break,
      }
    }
    if result.len() < min {
      None
    } else {
      Some((result, position))
    }
  })
}

fn opt<'a, A: 'a>(a: Parser<'a, A>) -> Parser<'a, Option<A>> {
  Parser::new(move |x, i, f| match (a.method)(x, i, f) {
    Some((value, i)) => Some((Some(value), i)),
    None => Some((None, i)),
  })
}

fn seq<'a, A: 'a, B: 'a>(a: Parser<'a, A>, b: Parser<'a, B>) -> Parser<'a, (A, B)> {
  Parser::new(move |x, i, f| {
    (a.method)(x, i, f).map(|(a, i)| (b.method)(x, i, f).map(|(b, i)| ((a, b), i))).unwrap_or(None)
  })
}

fn tag<'a>(tag: &'a str) -> Parser<'a, &'a str> {
  let expected = Rc::new(format!("{:?}", tag));
  Parser::new(move |x, i, f| {
    if x.iter().skip(i).take(tag.len()).eq(tag.as_bytes().iter()) {
      Some((tag, i + tag.len()))
    } else {
      update(expected.clone(), i, f);
      None
    }
  })
}

fn predicate<'a, F>(callback: F, name: &str) -> Parser<'a, u8>
where
  F: Fn(u8) -> bool + 'a,
{
  let expected = Rc::new(format!("{:?}", name));
  Parser::new(move |x, i, f| {
    if i < x.len() && callback(x[i]) {
      Some((x[i], i + 1))
    } else {
      update(expected.clone(), i, f);
      None
    }
  })
}

fn digit(x: u8) -> bool {
  b'0' <= x && x <= b'9'
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
      seq(opt(seq(tag("."), digits2)), opt(seq(any(vec![tag("e"), tag("E")]), digits3))),
    );
    assert_eq!(
      parser.parse("1.2345e56"),
      Result::Ok(((None, ""), (Some((".", vec![50, 51, 52, 53])), Some(("e", vec![53, 54])))))
    );
  }
}
