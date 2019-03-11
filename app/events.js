const fs = require('fs');
const path = require('path');
const utils = require('./utils');
const App = require('./store');
const dbCore = require('./db.js');
const imGroup = require('./im-group');
const { createAddContactNotice } = require('./notices');
const baseContact = require('./contacts');
const baseNotice = require('./notices');
const noticedom = require('./notices/dom');
const noticedb = require('./notices/db');

/* functions for request messages */
/**
 * 回调函数，收到其他客户端发来的“ping”请求
 * @param {String} src
 * @param {Object} payload
 * @param {Number} responseID
 */
function serverPing(src, payload, responseID) {
  // 接收到其他客户端的 ping 消息，更新界面用户状态（在线、离线）
  App.actions.updateGUIContactStatus(utils.parseAddr(src).publicKey);

  let opts = {
    toUser: src,
    data: JSON.stringify({
      type: 'Response',
      cmd: payload.cmd,
      request_id: payload.request_id,
      msg: 'ping pang'
    }),
    needACK: true,
    needResponse: false,
    onSuccess: () => {},
    onError: () => {},
    responseID: responseID
  };
  utils.cmSend(opts);
}

/**
 * 回调函数，收到其他客户端发来的“获取用户信息”请求
 * @param {String} src
 * @param {Object} payload
 * @param {Number} responseID
 */
function serverUserInfo(src, payload, responseID) {
  let opts = {
    toUser: src,
    data: JSON.stringify({
      type: 'Response',
      cmd: payload.cmd,
      request_id: payload.request_id,
      msg: {
        nickname: App.user.nickname,
        publicKey: App.user.publicKey,
        avatar: App.user.avatar
      }
    }),
    needACK: true,
    needResponse: false,
    onSuccess: () => {},
    onError: () => {},
    responseID: responseID
  };
  utils.cmSend(opts);
}

/**
 * 回调函数，收到其他客户端发来的“下载文件”请求
 * @param {String} src
 * @param {Object} payload
 * @param {Number} responseID
 */
function serverDownloadFile(src, payload, responseID) {
  `
    {
        type: 'Request',
        cmd: 'DOWNLOAD_FILE',
        request_id: 1,
        msg: {
            id: 1, // 被下载的文件在本地数据库下载表中的 id
            file_hash: '...', // 文件哈希
            fragment_size: 10240, // 分片大小
            save_offset: 0 // 偏移量
        }
    }
    `;
  utils.log('[下载任务] 收到下载请求', src);
  const db = App.db;
  const msg = payload.msg;
  const fileInfo = dbCore.getFileByHash(db, msg['file_hash']);

  utils.log('[下载任务] 获取要被下载的文件', fileInfo);
  fs.open(fileInfo['file_path'], 'r', function(err, fd) {
    if (err) {
      console.error('[下载任务] 打开文件失败', err);
      return;
    }

    let length = msg['fragment_size'];
    let offset = msg['save_offset'];
    let fileSize = fileInfo['file_size'];

    // 如果剩余文件片段长度小于请求文件长度
    // 就将分片大小设置为剩余文件片段长度
    if (offset + length > fileSize) {
      length = fileSize - offset;
      msg['fragment_size'] = length;
    }

    let buf = new Buffer(length);
    utils.log('[下载任务] offset 检测', fd, offset, length, msg);
    fs.readSync(fd, buf, 0, length, offset);
    let fileBase64 = buf.toString('base64');
    msg.data = fileBase64;

    let opts = {
      toUser: src,
      data: JSON.stringify({
        type: 'Response',
        cmd: payload.cmd,
        request_id: payload['request_id'],
        msg: msg
      }),
      needACK: true,
      needResponse: false,
      onSuccess: () => {},
      onError: () => {},
      responseID: responseID
    };
    utils.cmSend(opts);

    fs.closeSync(fd);
  });
}

/**
 * 回调函数，收到其他客户端发来的“文件搜索”请求
 * @param {String} src
 * @param {Object} payload
 * @param {Number} responseID
 */
function serverSearchFile(src, payload, responseID) {
  `
    {
        type: 'Request',
        cmd: 'SEARCH_FILE',
        request_id: 1,
        msg: {
            kw: '关键字'
        }
    }
    `;
  utils.log('REQUEST SEARCH_FILE', src, payload);
  const db = App.db;
  const msg = payload.msg;
  const publicKey = App.user.publicKey;
  const rows = dbCore.search(db, msg, publicKey);

  let opts = {
    toUser: src,
    data: JSON.stringify({
      type: 'Response',
      cmd: payload.cmd,
      request_id: payload['request_id'],
      msg: {
        data: rows
      }
    }),
    needACK: true,
    needResponse: false,
    onSuccess: () => {},
    onError: () => {},
    responseID: responseID
  };
  utils.cmSend(opts);
}

exports.serverSearchFile = serverSearchFile;

/**
 * 回调函数，收到其他客户端发来的“添加联系人”请求
 * @param {String} src
 * @param {Object} payload
 * @param {Number} responseID
 */
function serverAddContact(src, payload) {
  const notice = payload.msg.notice;

  createAddContactNotice({
    key: notice.key,
    sender: notice.payload.sender,
    receiver: notice.payload.receiver,
    status: notice.status
  });
  noticedom.setNoticeBadge('show');
}

/* functions for response messages */
/**
 * 回调函数，收到其他客户端返回的“ping”响应
 * @param {String} src
 * @param {Object} payload
 */
function clientPing(src, payload) {
  utils.log('clientPing', src, payload);
  // 更新界面联系人状态（在线、离线）
  App.actions.updateGUIContactStatus(utils.parseAddr(src).publicKey);
}

exports.clientPing = clientPing;

/**
 * 回调函数，收到其他客户端返回的“获取用户信息”响应
 * @param {String} src
 * @param {Object} payload
 */
function clientUserInfo(src, payload) {
  const user = payload.msg;
  const _addr = utils.parseAddr(src);
  const _user = {
    nickname: user.nickname,
    avatar: user.avatar,
    publicKey: _addr.publicKey
  };

  dbCore.updateUser(App.db, _user);
  imGroup.renderGUIContacts();
}

exports.clientUserInfo = clientUserInfo;

/**
 * 添加联系人请求响应回调函数
 * @param {String} src 联系人地址
 * @param {Object} res 响应内容
 */
function onAddContactResponse(src, res) {
  const notice = res.msg.notice;
  const receiver = notice.payload.receiver;

  // 将联系人公钥地址先存入数据库，发送 USER_INFO 事件请求
  // 返回数据后更新用户昵称、头像信息
  dbCore.registerUser(
    App.db,
    receiver.publicKey,
    receiver.nickname,
    App.defaultAvatar,
    1,
    notice.status
  );
  // 刷新联系人列表
  imGroup.renderGUIContacts();
  const dbNotice = noticedb.updateNoticeStatus(
    App.db,
    notice.key,
    notice.status
  );
  baseNotice.cacheNotice(dbNotice, true);
}

exports.onAddContactResponse = onAddContactResponse;

/**
 * 回调函数，收到其他客户端返回的“文件搜索”响应
 * @param {String} src
 * @param {Object} payload
 */
function clientSearchFile(src, payload) {
  utils.log('RESPONSE SEARCH_FILE', src, payload);
  let _addr = utils.parseAddr(src);
  let user = dbCore.getUserByPublicKey(App.db, _addr.publicKey);

  if (
    !user ||
    $('#tab__contact_u' + user.id).length === 0 ||
    $('#tab__contact_u' + user.id).hasClass('hide')
  ) {
    return;
  }

  let $list = $('#tab__contact_u' + user.id).find('.app__files__wrapper tbody');
  let data = payload.msg.data;
  let html = '';
  let queryKey = 'user' + user.id;
  let cacheInfo = App.caches[queryKey];
  let pageInfo = App.page[queryKey];

  if (pageInfo.offset === 0) {
    $list.empty();
    App.caches[queryKey] = {};
  }

  cacheInfo = App.caches[queryKey];

  for (let index in data) {
    let item = data[index];
    let temp =
      '<tr data-public-key="' +
      item.publicKey +
      '" data-file-hash="' +
      item.hash +
      '" data-file-index="' +
      index +
      '">';
    temp += '<td><div class="nickname">' + item['nickname'] + '</div></td>';
    temp +=
      '<td><div class="filename uic-text-ellipsis" title="' +
      item['file_name'] +
      '">' +
      item['file_name'] +
      '</div></td>';
    temp += '<td>' + (item['file_size'] / 1000).toFixed(2) + '</td>';
    temp +=
      '<td><a href="javascript:;" class="app__files__btn--download">download</a></td>';
    temp += '</tr>';
    html += temp;

    // 更新搜索结果缓存
    cacheInfo[item.hash] = item;
  }

  $list.append(html);

  // 更新翻页对象
  pageInfo.offset += pageInfo.limit;

  if (data.length < pageInfo.limit) {
    App.actions.changeLoadmore($('.loadmore--search'), 'no-more');
  } else {
    App.actions.changeLoadmore($('.loadmore--search'), 'loadmore');
  }
}

exports.clientSearchFile = clientSearchFile;

/**
 * 回调函数，收到其他客户端返回的“文件下载”响应
 * @param {String} src
 * @param {Object} payload
 */
function clientDownloadFile(src, payload) {
  utils.log('[下载文件] 收到数据');
  utils.log('  地址:', src);
  const msg = payload.msg;
  const db = App.db;
  const fileInfo = dbCore.getFileFromProcessingFiles(db, msg['file_hash']);

  utils.log('检查文件是否存在 data:', fileInfo);

  if (fileInfo) {
    let fileName = path.resolve(App.path.download, fileInfo['file_name']);
    let tempFileName = fileName + '.scstemp';

    fs.open(tempFileName, 'a+', function(err, fd) {
      if (err) {
        console.error('打开文件失败，err:', err);
        return;
      }

      // 文件片段的偏移量
      if (msg['save_offset'] !== fileInfo['save_offset']) {
        utils.log('文件片段偏移量不正确');
        return;
      }

      // 判断是否超出了文件的期望长度
      if (msg['save_offset'] + msg['fragment_size'] > fileInfo['file_size']) {
        utils.log('文件片段长度不正确');
        return;
      }

      // 将下载的数据片段写入文件
      let fileBuf = new Buffer(msg['data'], 'base64');
      if (fileBuf.length !== msg['fragment_size']) {
        utils.log('文件片段长度不匹配');
        return;
      }
      fs.writeSync(fd, fileBuf, 0, fileBuf.length, msg['save_offset']);
      fs.closeSync(fd);

      // 获取当前文件大小
      let savedSize = fs.statSync(tempFileName).size;

      let sql;

      utils.log('size', savedSize, fileInfo['file_size']);
      if (savedSize === fileInfo['file_size']) {
        // 该文件下载完成
        sql = `update download_files set save_offset = ${savedSize}, status = "completed" where id = ${
          fileInfo.id
        }`;
        utils.log('文件下载完成', payload.cmd, payload.request_id);

        // 判断rename之后的文件名是否跟硬盘中已存在的文件重名
        let newFileName, newFileBaseName;

        if (fs.existsSync(fileName)) {
          const extname = path.extname(fileName);
          const basenameNoExt = path.basename(fileName, extname);
          let dupNum = 2;

          // 生成新文件名 如：a(2).jpg, a(3).jpg
          while (true) {
            newFileBaseName = `${basenameNoExt}(${dupNum})${extname}`;
            newFileName = path.resolve(App.path.download, newFileBaseName);

            if (fs.existsSync(newFileName)) {
              dupNum += 1;
            } else {
              break;
            }
          }
        } else {
          newFileName = fileName;
          newFileBaseName = path.basename(fileName);
        }

        fs.renameSync(tempFileName, newFileName);
        let updateFileNameSQL =
          'update download_files set file_name = ? where id = ?';
        db.prepare(updateFileNameSQL).run(newFileBaseName, fileInfo.id);
        $('#btn--show-download-panel')
          .find('.badge-dot')
          .removeClass('hide');
      } else {
        // 该文件下载未完成
        sql = `update download_files set save_offset = ${savedSize}, request_num = 0 where id = ${
          fileInfo.id
        }`;
        utils.log('文件继续下载', payload.cmd, payload.request_id);
      }

      db.prepare(sql).run();
      App.actions.loadProcessingFiles();
      App.actions.downloadTask();
    });
  }
}

exports.clientDownloadFile = clientDownloadFile;

/**
 * NKN Client Websocket 收到消息时触发此函数
 * @param {*} src
 * @param {*} payload
 */
function clientOnMessage(src, responseID, payload) {
  const _payload = JSON.parse(payload);
  utils.log('clientOnMessage', src, _payload);

  /** 收到消息时更新对方的状态 */
  App.actions.updateGUIContactStatus(utils.parseAddr(src).publicKey);

  if (_payload.type === 'Request') {
    switch (_payload.cmd) {
      case 'PING':
        serverPing(src, _payload, responseID);
        break;

      case 'USER_INFO':
        serverUserInfo(src, _payload, responseID);
        break;

      case 'REGISTER_FILE':
        serverRegisterFile(src, _payload, responseID);
        break;

      case 'SEARCH_FILE':
        serverSearchFile(src, _payload, responseID);
        break;

      case 'DOWNLOAD_FILE':
        serverDownloadFile(src, _payload, responseID);
        break;

      case 'ADD_CONTACT':
        serverAddContact(src, _payload, responseID);
        break;
      case 'ADD_CONTACT_RESPONSE':
        onAddContactResponse(src, _payload);
        break;
      case 'INITIATING_CHAT':
        baseContact.handleInitiatingChatRequest(src, _payload, responseID);
        break;
      case 'GET_MSG_DAT_BC': {
        let res = dbCore.checkMsgDataIsCached(App.db, _payload.msgKey);

        let resMsg = {
          cmd: 'GET_MSG_DAT_BCRS',
          status: res ? true : false
        };

        console.log('RX GET_MSG_DAT_BC', _payload, resMsg);

        App.cm.sendMessage(
          src,
          JSON.stringify(resMsg),
          true,
          false,
          1,
          3000,
          () => {},
          () => {},
          null,
          responseID
        );
        break;
      }
      default:
        break;
    }
  } else {
    imGroup.bindEvent_On_ImMsg(src, _payload, responseID);
  }
}

/**
 * 初始化事件监听
 */
function initEvents() {
  let mainClient;

  mainClient = App.clients.main;

  /**
   * 调用通讯模块“接收消息回调函数”
   *
   * 收到消息后通过 clientOnMessage 执行事件分发
   */
  App.cm.reviceMessage(
    (src, id, decryptedMsg, needResponse, offset, count, total) => {
      utils.debugAddStats('main', 'receive');
      App.actions.refreshDebugPanel();
      clientOnMessage(src, id, decryptedMsg);
    },
    null
  );

  /**
   * 监听通讯模块 onconnect 事件
   * 当通讯模块连接成功时，启动文件下载定时器
   */
  mainClient.on('connect', function() {
    setInterval(function() {
      App.actions.downloadTask();
    }, 5000);
  });
}

exports.initEvents = initEvents;
