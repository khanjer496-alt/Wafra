#!/usr/bin/env node

const { readFileSync } = require('node:fs');
const path = require('node:path');

const app = JSON.parse(readFileSync(path.join(__dirname, '../../app.json'), 'utf8'));
const schemes = app.expo?.ios?.infoPlist?.LSApplicationQueriesSchemes;

if (!Array.isArray(schemes) || !schemes.includes('shortcuts')) {
  throw new Error(
    'iOS Shortcut availability checks require LSApplicationQueriesSchemes to include "shortcuts"',
  );
}

console.log('ios-shortcuts-config.test.js: 1 passed');
