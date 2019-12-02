const path = require('path');
const webpack = require('webpack');

module.exports = {
  mode: 'production',
  entry: {
    'embeds': './ui.js',
  },
  //devtool: 'inline-source-map',
  output: {
    path: path.join(__dirname, '../static/'),
    filename: '[name].js',
    libraryTarget: 'global',
    globalObject: 'self'
  },

  devServer: {
    compress: true,
    port: 9021,
  }
};
