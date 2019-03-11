const { encrypt, decrypt, log } = require('./utils');
const fs = require('fs');
const path = require('path');

// 钱包文件默认文件名
const USER_WALLET_FILENAME = 'wallet.dat';
// 数据库文件默认文件名
const USER_DB_FILENAME = 'db.sqlite3';

/**
 * 创建钱包文件
 * @param {*} app APP 数据对象
 * @param {*} auths  身份验证信息
 * @param {*} password 密码
 */
function newAccount(app, userAuth, password) {
  let walletPath = path.resolve(app.path.root, USER_WALLET_FILENAME);
  let auth = null;

  if (fs.existsSync(walletPath)) {
    auth = JSON.parse(fs.readFileSync(walletPath));
  } else {
    auth = {
      accounts: {},
      lastLoginPublicKey: null
    };
  }

  auth.accounts[userAuth.publicKey] = {
    nickname: userAuth.nickname,
    publicKey: userAuth.publicKey,
    privateKey: encrypt(userAuth.privateKey, password),
    avatar: userAuth.avatar
  };
  auth.lastLoginPublicKey = userAuth.publicKey;

  fs.writeFileSync(walletPath, JSON.stringify(auth));
}

/**
 * 加载钱包文件
 */
function loadWallet(app) {
  let walletPath = path.resolve(app.path.root, USER_WALLET_FILENAME);
  if (fs.existsSync(walletPath)) {
    let auths = JSON.parse(fs.readFileSync(walletPath));
    return auths;
  } else {
    return null;
  }
}

/**
 * 用户登录
 * @param {*} app
 * @param {*} publicKey
 * @param {*} password
 */
function login(app, publicKey, password) {
  let auth = loadWallet(app);
  let account = auth.accounts[publicKey];

  if (account) {
    let privateKey;

    try {
      privateKey = decrypt(account.privateKey, password);
    } catch (error) {
      privateKey = '';
    }

    if (privateKey === '') {
      alert('Password is not correct!');
      return false;
    }

    let userInfo = {
      nickname: account.nickname,
      publicKey: account.publicKey,
      privateKey: privateKey,
      avatar: account.avatar
    };

    return userInfo;
  } else {
    alert('Account not exists!');
    return false;
  }
}

/**
 * 导出用户文件
 * @param {String} outPath 导出目录
 */
function exportUserFiles(app, outPath) {
  if (fs.existsSync(outPath)) {
    let dirPath = path.resolve(outPath, 'scsbak');
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath);
    }

    let dbPath = path.resolve(app.path.user, USER_DB_FILENAME);
    fs.copyFileSync(dbPath, path.resolve(dirPath, USER_DB_FILENAME));
    let walletPath = path.resolve(app.path.user, USER_WALLET_FILENAME);
    fs.copyFileSync(walletPath, path.resolve(dirPath, USER_WALLET_FILENAME));
  } else {
    alert('export failed. Path not exists.');
  }
}

/**
 * 导入用户文件
 * @param {*} app
 * @param {*} importPath
 */
function importUserFiles(app, importPath) {
  log('importUserFiles', importPath);
  if (fs.existsSync(importPath)) {
    let fromDBPath = path.resolve(importPath, USER_DB_FILENAME);
    let toDBPath = path.resolve(app.path.user, USER_DB_FILENAME);

    if (fs.existsSync(toDBPath)) {
      if (window.confirm('Database file exists! Cover it?')) {
        fs.copyFileSync(fromDBPath, toDBPath);
      }
    }

    let fromWalletPath = path.resolve(importPath, USER_WALLET_FILENAME);
    let toWalletPath = path.resolve(app.path.user, USER_WALLET_FILENAME);

    if (fs.existsSync(toWalletPath)) {
      if (window.confirm('Wallet.dat exists! Cover it?')) {
        fs.copyFileSync(fromWalletPath, toWalletPath);
      }
    }
  } else {
    alert('Directory not exists.');
  }
}

module.exports = exports = {
  newAccount,
  loadWallet,
  login,
  exportUserFiles,
  importUserFiles
};
