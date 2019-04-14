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
use nlu::base::Match;
use nlu::corrector::{Corrector, Diff};
use nlu::fantasy::compile;
use nlu::generator::Generator;
use nlu::parser::Parser;
use payload::base::Payload;
use payload::lambda::Lambda;
use std::fs::read_to_string;
use std::rc::Rc;
use std::time::SystemTime;

fn render<T>(matches: &[Rc<Match<T>>]) -> String {
  let texts = matches.iter().map(|x| x.texts.get("latin").map(|y| y.as_str()).unwrap_or("?"));
  texts.collect::<Vec<_>>().join(" ")
}

fn main() -> Result<()> {
  let args: Vec<_> = std::env::args().collect();
  if args.len() != 4 || !(args[2] == "generate" || args[2] == "parse") {
    Err("Usage: ./main $gramar [generate|parse] $input")?;
  }
  let (file, generate, input) = (&args[1], args[2] == "generate", &args[3]);
  let data = read_to_string(file).map_err(|x| format!("Failed to read file {}: {}", file, x))?;
  let grammar = compile(&data, HindiLexer::new)
    .map_err(|x| format!("Failed to compile grammar: {}\n\n{:?}", file, x))?;

  let time = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_secs();
  println!("Using seed: {}", time);
  let mut rng = rand::SeedableRng::seed_from_u64(time);

  let tree = if generate {
    let generator = Generator::new(&grammar);
    let maybe = generator.generate(&mut rng, &Some(Lambda::parse(input)?));
    maybe.ok_or_else(|| format!("Failed to generate output: {:?}", input))?
  } else {
    let maybe = Parser::new(&grammar).set_debug(true).parse(input);
    maybe.ok_or_else(|| format!("Failed to parse input: {:?}", input))?
  };

  println!("Old value repr: {}", tree.value.repr());
  println!("Old Latin text: {}", render(&tree.matches()));
  let correction = Corrector::new(&grammar).correct(&mut rng, &tree);
  println!("New Latin text: {}", render(&correction.tree.matches()));
  for diff in correction.diff {
    if let Diff::Wrong(x) = diff {
      println!("Corrected {} -> {}:", render(&x.old_matches), render(&x.new_matches));
      x.errors.iter().for_each(|y| println!("- {}", y));
    }
  }
  Ok(())
}
