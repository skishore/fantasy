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
use nlu::generator::Generator;
use nlu::parser::Parser;
use payload::base::Payload;
use payload::lambda::Lambda;
use std::fs::read_to_string;
use std::time::SystemTime;

fn main() -> Result<()> {
  let args: Vec<_> = std::env::args().collect();
  if args.len() != 4 || !(args[1] == "generate" || args[1] == "parse")   {
    Err("Usage: ./main [generate|parse] $grammar $input")?;
  }
  let (generate, file, input) = (args[1] == "generate", &args[2], &args[3]);
  let data = read_to_string(file).map_err(|x| format!("Failed to read file {}: {}", file, x))?;
  // TODO(skishore): This operation may panic and is a complete hack.
  let grammar = compile(&data, |x| HindiLexer::<Lambda>::new(&x[11..x.len() - 4]))
    .map_err(|x| format!("Failed to compile grammar: {}\n\n{:?}", file, x))?;
  if generate {
    let generator = Generator::new(&grammar);
    let time = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_secs();
    println!("Using seed: {}", time);
    let mut rng = rand::SeedableRng::seed_from_u64(time);
    let maybe = generator.generate(&mut rng, &Some(Lambda::parse(input)?));
    let nodes = maybe.ok_or_else(|| format!("Failed to generate output: {:?}", input))?.matches();
    let texts = nodes.iter().map(|x| x.texts.get("latin").cloned().unwrap_or("?".into()));
    let value = texts.collect::<Vec<String>>().join(" ");
    Ok(println!("{}", value))
  } else {
    let maybe = Parser::new(&grammar).set_debug(true).parse(input);
    let value = maybe.ok_or_else(|| format!("Failed to parse input: {:?}", input))?.value;
    Ok(println!("{}", value.stringify()))
  }
}
