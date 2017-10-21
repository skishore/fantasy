#!/usr/bin/env node

const fs = require('fs');

const base = require('../lib/base');
const commander = require('../external/commander');
const grammar = require('../parsing/grammar');
const parser = require('../parsing/parser');

commander
  .version('0.1.0')
  .arguments('<grammar> <input...>')
  .action((grammar, input) => {})
  .parse(process.argv);

const readEntireStream = (stream) => {
  const data = [];
  stream.on('data', (x) => data.push(x));
  return new Promise((resolve, reject) => {
    stream.on('end', () => resolve(data.join('')));
    stream.on('error', reject);
  });
}

readEntireStream(fs.createReadStream(commander.args[0]))
  .then((data) => grammar.Grammar.from_code(data))
  .then((grammar) => [grammar, new parser.Parser(grammar)])
  .then(([grammar, parser]) => {
    const input = commander.args[1].join(' ');
    console.error(parser.debug());
    for (const token of grammar.lexer.iterable(input)) {
      console.error();
      parser.feed(token);
      console.error(parser.debug());
    }
    console.error();
    console.log(base.debug(parser.result()));
  }).catch((error) => console.error(error.stack));
