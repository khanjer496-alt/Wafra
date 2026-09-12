/* global __dirname */
const { realpathSync } = require('node:fs');
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Local checkouts may share dependencies through a symlink. Metro must watch
// its resolved target; normal npm installs retain Expo's default configuration.
const modules = path.join(__dirname, 'node_modules');
const resolvedModules = realpathSync(modules);
if (resolvedModules !== modules) {
  config.watchFolders = [...new Set([...config.watchFolders, resolvedModules])];
}

module.exports = config;
