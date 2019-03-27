#![allow(dead_code)]
#![feature(test)]

use jemallocator::Jemalloc;

extern crate jemallocator;
extern crate rand;
extern crate regex;
extern crate rustc_hash;

#[cfg(test)]
extern crate test;

#[global_allocator]
static GLOBAL: Jemalloc = Jemalloc;

#[macro_use]
mod lib;
mod hindi;
mod nlu;
mod payload;

use lib::base::{HashMap, Result};
use nlu::base::{Lexer, Match, Tense, Token};
use nlu::fantasy::compile;
use nlu::parser::Parser;
use payload::base::Payload;
use payload::lambda::Lambda;
use std::fs::read_to_string;
use std::rc::Rc;

struct SpaceLexer {}

impl SpaceLexer {
  fn default_match<T: Payload>(&self, term: &str) -> Rc<Match<T>> {
    Rc::new(Match { tenses: vec![], texts: HashMap::default(), value: T::base_lex(term) })
  }
}

impl<T: Payload> Lexer<Option<T>, T> for SpaceLexer {
  fn fix(&self, _: &Match<T>, _: &Tense) -> Vec<Rc<Match<T>>> {
    unimplemented!()
  }

  fn lex<'a: 'b, 'b>(&'a self, input: &'b str) -> Vec<Token<'b, T>> {
    let xs = input.split(' ').map(|x| {
      let matches = vec![(x, (0.0, self.default_match(x)))];
      Token { matches: matches.into_iter().collect(), text: x }
    });
    xs.collect()
  }

  fn tense(&self, _: &HashMap<String, String>) -> Result<Tense> {
    Ok(Tense::default())
  }

  fn unlex(&self, terminal: &str, _: &Option<T>) -> Vec<Rc<Match<T>>> {
    vec![self.default_match(terminal)]
  }
}

fn main() -> Result<()> {
  let args: Vec<_> = std::env::args().collect();
  if args.len() != 3 {
    Err("Usage: ./main $grammar $input")?;
  }
  let (file, input) = (&args[1], &args[2]);
  let data = read_to_string(file).map_err(|x| format!("Failed to read file {}: {}", file, x))?;
  let grammar = compile::<Lambda>(&data, Box::new(SpaceLexer {}))
    .map_err(|x| format!("Failed to compile grammar: {}\n\n{:?}", file, x))?;
  let maybe = Parser::new(&grammar).set_debug(true).parse(input);
  let value = maybe.ok_or_else(|| format!("Failed to parse input: {:?}", input))?.value;
  Ok(println!("{}", value.stringify()))
}
