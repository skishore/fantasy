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

use hindi::lexer::HindiLexer;
use lib::base::Result;
use nlu::fantasy::compile;
use nlu::parser::Parser;
use payload::base::Payload;
use payload::lambda::Lambda;
use std::fs::read_to_string;

fn main() -> Result<()> {
  let args: Vec<_> = std::env::args().collect();
  if args.len() != 3 {
    Err("Usage: ./main $grammar $input")?;
  }
  let (file, input) = (&args[1], &args[2]);
  let data = read_to_string(file).map_err(|x| format!("Failed to read file {}: {}", file, x))?;
  // TODO(skishore): This operation may panic and is a complete hack.
  let grammar = compile(&data, |x| HindiLexer::<Lambda>::new(&x[11..x.len() - 4]))
    .map_err(|x| format!("Failed to compile grammar: {}\n\n{:?}", file, x))?;
  let maybe = Parser::new(&grammar).set_debug(true).parse(input);
  let value = maybe.ok_or_else(|| format!("Failed to parse input: {:?}", input))?.value;
  Ok(println!("{}", value.stringify()))
}
