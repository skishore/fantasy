use std::rc::Rc;

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

fn map<'a, A: 'a, B: 'a>(parser: Parser<'a, A>, callback: Box<Fn(A) -> B>) -> Parser<'a, B> {
  Parser::new(move |x, i, f| match (parser.method)(x, i, f) {
    Some((value, i)) => Some((callback(value), i)),
    None => None,
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

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn any_works() {
    let parser = any(vec![tag("a"), map(seq(tag("b"), tag("c")), Box::new(|_| "bc"))]);
    let mut failure = (vec![], 0);
    assert_eq!((parser.method)(b"bc", 0, &mut failure), None);
    assert_eq!(failure, (vec![], 0));
  }
}
