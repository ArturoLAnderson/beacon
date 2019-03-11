const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CleanWebpackPlugin = require('clean-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = {
  entry: ['babel-polyfill', './app/index.js'],
  output: {
    path: path.join(__dirname, 'www'),
    filename: '[name].[hash].js'
  },

  // production 模式下不生成 source map
  // devtool: process.env['NODE_ENV'] === 'production' ? false : 'source-map',

  externals: {
    'better-sqlite3': 'commonjs better-sqlite3',
    'nano-time': "require('nano-time')",
    child_process: "require('child_process')",
    process: "require('process')",
    fs: "require('fs')",
    os: "require('os')",
    path: "require('path')",
    crypto: "require('crypto')",
    // Buffer: "require('Buffer')",
    // buffer: "require('buffer')",
    electron: "require('electron')"
  },

  module: {
    rules: [
      {
        test: /\.js$/,
        use: {
          loader: 'babel-loader'
        }
      },

      {
        test: /.(png|woff|woff2|eot|ttf|svg)$/,
        loader: 'url-loader?limit=100000'
      },

      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader']
      }
    ]
  },

  resolve: {
    extensions: ['.js'],
    plugins: []
  },

  plugins: [
    new HtmlWebpackPlugin({ template: './app/index.html' }),
    new CleanWebpackPlugin(
      ['www/main.*.js', 'www/main.*.css'], //匹配删除的文件
      {
        root: __dirname, //根目录
        verbose: true, //开启在控制台输出信息
        dry: false //启用删除文件
      }
    ),
    new webpack.ProvidePlugin({
      $: 'jquery'
    }),

    new MiniCssExtractPlugin({
      filename: '[name].[chunkhash:8].css',
      chunkFilename: '[id].css'
    })
    // new webpack.HotModuleReplacementPlugin()
  ],
  devServer: {
    contentBase: [path.join(__dirname, 'www')], //静态文件根目录
    watchContentBase: true,
    port: 2018, // 端口
    host: 'localhost',
    overlay: true,
    compress: true // 服务器返回浏览器的时候是否启动gzip压缩
  }
};
