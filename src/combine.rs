use std::rc::Rc;

type Failure = (Vec<Rc<String>>, usize);

type Output<T> = Option<(T, usize)>;

type Parser<T> = Rc<Fn(&[u8], usize, &mut Failure) -> Output<T>>;

fn update(expected: Rc<String>, i: usize, failure: &mut Failure) {
  if i < failure.1 {
    return;
  } else if i > failure.1 {
    failure.0.clear();
    failure.1 = i;
  }
  failure.0.push(expected);
}

fn any<A: 'static>(parsers: Vec<Parser<A>>) -> Parser<A> {
  Rc::new(move |x, i, f| {
    for parser in &parsers {
      match parser(x, i, f) {
        Some(x) => return Some(x),
        None => continue,
      }
    }
    None
  })
}

fn map<A: 'static, B: 'static, F: 'static>(parser: Parser<A>, callback: F) -> Parser<B>
where
  F: Fn(A) -> B,
{
  Rc::new(move |x, i, f| match parser(x, i, f) {
    Some((value, i)) => Some((callback(value), i)),
    None => None,
  })
}

fn seq<A: 'static, B: 'static>(a: Parser<A>, b: Parser<B>) -> Parser<(A, B)> {
  Rc::new(move |x, i, f| {
    a(x, i, f).map(|(a, i)| b(x, i, f).map(|(b, i)| ((a, b), i))).unwrap_or(None)
  })
}

fn tag(tag: &str) -> Parser<Rc<String>> {
  let tag = Rc::new(tag.to_owned());
  let expected = Rc::new(format!("{:?}", tag));
  Rc::new(move |x, i, f| {
    if x.iter().skip(i).take(tag.len()).eq(tag.as_bytes().iter()) {
      Some((tag.clone(), i + tag.len()))
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
    let parser = any(vec![tag("a"), map(seq(tag("b"), tag("c")), |_| Rc::new("bc".to_owned()))]);
    let mut failure = (vec![], 0);
    assert_eq!(parser(b"bc", 0, &mut failure), None);
    assert_eq!(failure, (vec![], 0));
  }
}
