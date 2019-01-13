#![feature(test)]

#[macro_use]
extern crate lazy_static;
extern crate regex;

#[cfg(test)]
extern crate test;

mod combine;
mod lambda;

fn main() {
  lambda::main();
}
