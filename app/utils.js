const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const pkg = require('../package.json');
const shell = require('shelljs');
const appRoot = path.dirname(__dirname);
const Buffer = require('buffer').Buffer;
let CryptoJS = require('crypto-js');
const Jimp = require('jimp/es').default;
const { calcRetryTime } = require('common.utils');
// var toArrayBuffer = require('to-arraybuffer');

// var XBuffer = require('buffer/').Buffer; // note: the trailing slash is important!
const App = require('./store');

const isDevelopment = process.env['NODE_ENV'] !== 'production';

if (isDevelopment) {
  $('body').removeClass('prod');
}

/**
 * 获取 APP 数据存储目录
 * @param {String} platform 'win32', 'darwin'
 */
function getAppDataPath(platform) {
  switch (platform) {
    case 'win32':
      return path.join(os.homedir(), 'AppData', 'Roaming');
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support');
    case 'linux':
      return path.join(os.homedir(), '.Beacon');
    default:
      throw new Error('Platform not supported');
  }
}

/**
 * 获取默认用户数据存放目录
 * @param {String} platform 'win32', 'darwin'
 */
function getDefaultUserDataPath(platform, pkgName = null) {
  if (!pkgName) {
    pkgName = pkg.name;
  }
  return path.join(getAppDataPath(platform), pkgName);
}

/**
 * 获取应用所在目录路径
 */
function getApplicationPath() {
  if (process.env['NODE_DEV']) {
    return appRoot;
  } else if (process.platform === 'darwin') {
    return path.dirname(path.dirname(path.dirname(appRoot)));
  } else {
    return path.dirname(path.dirname(appRoot));
  }
}

function getFileMd5(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const input = fs.createReadStream(filePath);

    input.on('error', err => {
      reject(err);
    });

    input.on('readable', () => {
      const data = input.read();
      if (data) hash.update(data);
      else {
        resolve(hash.digest('hex'));
      }
    });
  });
}

/**
 * 解析 NKN addr 为 Object
 * @param {String}} addr
 */
function parseAddr(addr) {
  const dotIndex = addr.lastIndexOf('.');
  const publicKey = addr.substring(dotIndex + 1, addr.length);
  const short = formatPublicKey(publicKey);

  return {
    identifier: addr.substring(0, dotIndex),
    publicKey: publicKey,
    short: short
  };
}

/**
 * 将公钥地址字符串转换为简写模式，如 03155e...745014
 * @param {*} publicKey
 */
function formatPublicKey(publicKey) {
  return `${publicKey.substring(0, 6)}...${publicKey.substring(
    publicKey.length - 6,
    publicKey.length
  )}`;
}

/**
 * 按路径创建文件
 * @param {String} fullPath
 */
function mkdirs(fullPath) {
  shell.mkdir('-p', fullPath);
}

/**
 * 显示顶部信息通知
 * @param {*} msg
 */
function showTopMsg(msg, timeout = 3000) {
  const $modal = $('#modal--top-msg');
  let handle = $modal.data('timeoutHandle');

  if (handle) {
    clearTimeout(handle);
  }

  $modal
    .find('.content')
    .empty()
    .html(msg);
  $modal.css('left', $(window).width() / 2 - $modal.width() / 2);
  // $modal.removeClass('v-hide');
  $modal.animate({
    top: 0
  });

  handle = setTimeout(() => {
    hideTopMsg();
  }, timeout);

  $modal.data('timeoutHandle', handle);
}

/**
 * 隐藏顶部信息通知
 */
function hideTopMsg() {
  // $('#modal--top-msg').addClass('v-hide');
  $('#modal--top-msg').animate({
    top: -50
  });
}

/**
 * 将传入的值输出到控制台（仅在开发模式下输出）
 * @param {Array} args
 */
function log(...args) {
  if (isDevelopment) {
    console.log(...args);
  }
}

const IV_STR = '012345678';
/**
 * 加密函数
 * @param {String} plainText 待加密的文本
 * @param {String} password 密码
 */
function encrypt(plainText, password) {
  let keyHex = CryptoJS.enc.Utf8.parse(password);
  let ivHex = CryptoJS.enc.Utf8.parse(IV_STR);
  let cipherText = CryptoJS.TripleDES.encrypt(plainText, keyHex, { iv: ivHex });

  return cipherText.toString();
}

/**
 * 待解密的文本
 * @param {String} cipherText
 * @param {String} password 密码
 */
function decrypt(cipherText, password) {
  let keyHex = CryptoJS.enc.Utf8.parse(password);
  let ivHex = CryptoJS.enc.Utf8.parse(IV_STR);
  let bytes = CryptoJS.TripleDES.decrypt(cipherText.toString(), keyHex, {
    iv: ivHex
  });
  let plainText = bytes.toString(CryptoJS.enc.Utf8);

  return plainText;
}

/**
 * 获取图片缩略图
 * @param {String} dataURL 图片的 dataURL
 */
function getImageThumbnail(dataURL) {
  return new Promise((resolve, reject) => {
    let base64String = dataURL.split(',')[1];
    let imageBuf = Buffer.from(base64String, 'base64');

    // var blob = new Blob([imageBuf]);
    // console.log(blob);
    // let bloburl = URL.createObjectURL(blob);

    // // let newImageBuf = imageBuf.buffer.slice(
    // //   imageBuf.byteOffset,
    // //   imageBuf.byteOffset + imageBuf.byteLength
    // // );

    // console.log(App.path.temp);
    // const tempImgPath = path.resolve(App.path.temp, 'temp');
    // try {
    //   fs.writeFileSync(tempImgPath, imageBuf, { encoding: 'base64' });
    // } catch (error) {
    //   console.log('write temp file error', error);
    // }

    Jimp.read(imageBuf)
      .then(img => {
        /* 生成缩略图 */
        let resizeImg;
        let limit = 150;
        let width = img.bitmap.width;
        let height = img.bitmap.height;

        // 按图片的宽、高最大的一方为基准按比例缩放
        // 如果这个值小于设定的 limit 值，就将 limit 修改为这个值
        if (width > height) {
          if (width < limit) {
            limit = width;
          }
          // 按宽缩放
          resizeImg = img.resize(limit, Jimp.AUTO);
        } else {
          if (height < limit) {
            limit = height;
          }
          // 按高缩放
          resizeImg = img.resize(Jimp.AUTO, limit);
        }
        /* 降低图像质量 */
        let lowQualityImg = resizeImg.quality(55);
        /* 保存处理后的图像 */
        lowQualityImg.getBase64(Jimp.MIME_PNG, function(err, data) {
          // 执行成功回调，将数据返回
          resolve({ err, data });
        });
      })
      .catch(err => {
        console.error('Jimp', err);
        // 执行失败回调，将错误信息返回
        reject(err);
      });
  });
}

/**
 * debug 面板增加请求统计数量
 */
function debugAddStats(clientType, actionType) {
  App.debug.stats[clientType][actionType] += 1;
}

/**
 * 使用通讯模块发送请求
 * @param {Object} options 通讯模块 sendMessage 配置项
 */
function cmSend(options) {
  // 如果未配置超时时间，就根据发送的内容长度自动计算并添加到配置项
  if (!options.retryWaitMS) {
    options.retryWaitMS = calcRetryTime(options.data);
  }

  // 默认配置
  let defaultOpts = {
    retryCount: 3, // 默认重试三次
    responseID: 0
  };

  // 合并参数配置项
  options = Object.assign(defaultOpts, options);
  // 调用通讯模块，发送消息到指定地址（options.toUser）
  App.cm.sendMessage(
    options.toUser,
    options.data,
    options.needACK,
    options.needResponse,
    options.retryCount,
    options.retryWaitMS,
    options.onSuccess,
    options.onError,
    options.onResponse,
    options.responseID,
    options.onProgress
  );
  // 记录发送数量
  debugAddStats('main', 'send');
}

module.exports = exports = {
  log: log,
  mkdirs: mkdirs,
  parseAddr: parseAddr,
  getFileMd5: getFileMd5,
  getAppDataPath: getAppDataPath,
  formatPublicKey: formatPublicKey,
  getDefaultUserDataPath: getDefaultUserDataPath,
  getApplicationPath: getApplicationPath,
  showTopMsg: showTopMsg,
  hideTopMsg: hideTopMsg,
  encrypt: encrypt,
  decrypt: decrypt,
  getImageThumbnail: getImageThumbnail,
  debugAddStats: debugAddStats,
  cmSend: cmSend
};
