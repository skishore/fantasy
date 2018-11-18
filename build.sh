#!/bin/bash
tsc && \
time node target/test/main.js && \
echo '' && \
prettier --no-bracket-spacing --parser typescript --single-quote --trailing-comma all --write src/**/*.ts && \
prettier --no-bracket-spacing --parser typescript --single-quote --trailing-comma all --write test/**/*.ts && \
tslint -c tslint.json -p tsconfig.json
