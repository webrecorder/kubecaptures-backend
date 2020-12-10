const path = require('path');
const webpack = require('webpack');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

const outputDir = process.env.APP_OUTPUT_DIR || path.join(__dirname, "./dist/");


module.exports = {
  mode: 'production',
  entry: {
    'app': './app.js',
  },
  //devtool: 'inline-source-map',
  output: {
    path: outputDir,
    filename: '[name].js',
    globalObject: 'self',
    libraryTarget: 'self',
  },

  plugins: [
    new MiniCssExtractPlugin(),
  ],

  module: {
    rules: [
    {
      test:  /\.svg$/,
      loader: 'svg-inline-loader'
    },
    {
      test: /ui.scss$/,
      loaders: ['css-loader', 'sass-loader']
    }
    ]
  },

  devServer: {
    compress: true,
    port: 9021,
    publicPath: '/static/',
    contentBase: '../'
  }
};
