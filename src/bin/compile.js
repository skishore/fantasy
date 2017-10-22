#!/usr/bin/env node

const fs = require('fs');

const commander = require('../external/commander');
const compiler = require('../parsing/compiler');

commander
  .version('0.1.0')
  .option('-i, --input [filename]', 'Read grammar file from <filename>')
  .option('-o, --output [filename]', 'Write compiled grammar to <filename>')
  .parse(process.argv);

const input = commander.input ?
  fs.createReadStream(commander.input) : process.stdin;
const output = commander.output ?
  fs.createWriteStream(commander.output) : process.stdout;

const readEntireStream = (stream) => {
  const data = [];
  stream.on('data', (x) => data.push(x));
  return new Promise((resolve, reject) => {
    stream.on('end', () => resolve(data.join('')));
    stream.on('error', reject);
  });
}

readEntireStream(input)
  .then((data) => compiler.Compiler.compile(data))
  .then((data) => output.write(data))
  .catch((error) => console.error(error.stack));
