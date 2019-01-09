#![feature(test)]

use std::collections::HashMap;
use std::rc::Rc;

mod combine;

type Args<T> = HashMap<usize, Rc<T>>;

trait Template<T> {
  fn merge(xs: Args<T>) -> Rc<T>;
  fn split(x: Rc<T>) -> Vec<Args<T>>;
}

// A specific type that we support templating for.

enum Binary {
  Conjunction,
  Disjunction,
  Join,
}

enum Unary {
  Not,
  Reverse,
}

enum Lambda {
  Binary(Binary, Vec<Rc<Lambda>>),
  Custom(String, Vec<Rc<Lambda>>),
  Terminal(String),
  Unary(Unary, Rc<Lambda>),
}

struct Operator {
  commutes: bool,
  precedence: usize,
  text: String,
}

impl Binary {
  fn data(&self) -> Operator {
    match self {
      Binary::Conjunction => Operator { commutes: true, precedence: 2, text: " & ".to_owned() },
      Binary::Disjunction => Operator { commutes: true, precedence: 2, text: " | ".to_owned() },
      Binary::Join => Operator { commutes: false, precedence: 0, text: ".".to_owned() },
    }
  }
}

impl Unary {
  fn data(&self) -> Operator {
    match self {
      Unary::Not => Operator { commutes: false, precedence: 3, text: "R".to_owned() },
      Unary::Reverse => Operator { commutes: false, precedence: 1, text: "~".to_owned() },
    }
  }
}

impl Lambda {
  fn stringify(&self) -> String {
    self.stringify_at(std::usize::MAX)
  }

  fn stringify_at(&self, context: usize) -> String {
    match self {
      Lambda::Binary(op, children) => {
        let Operator { commutes, precedence, text } = op.data();
        let mut base: Vec<_> = children.into_iter().map(|x| x.stringify_at(precedence)).collect();
        if commutes {
          base.sort();
        }
        if precedence < context {
          base.join(&text)
        } else {
          format!("({})", base.join(&text))
        }
      }
      Lambda::Custom(name, children) => {
        let base: Vec<_> = children.into_iter().map(|x| x.stringify()).collect();
        format!("{}({})", name, base.join(", "))
      }
      Lambda::Terminal(name) => name.to_owned(),
      Lambda::Unary(op, child) => {
        let Operator { precedence, text, .. } = op.data();
        let base = child.stringify_at(precedence);
        if let Unary::Reverse = op {
          format!("{}[{}]", text, base)
        } else if precedence < context {
          format!("{}{}", text, base)
        } else {
          format!("{}({})", text, base)
        }
      }
    }
  }
}

fn main() {
  let x = Lambda::Binary(
    Binary::Join,
    vec![
      Rc::new(Lambda::Binary(
        Binary::Disjunction,
        vec![
          Rc::new(Lambda::Terminal("foo".to_owned())),
          Rc::new(Lambda::Terminal("blah".to_owned())),
        ],
      )),
      Rc::new(Lambda::Terminal("baz".to_owned())),
    ],
  );
  println!("{}", x.stringify());
}
