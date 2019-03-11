/***
 * 联系人相关逻辑
 */

const { cmSend, showTopMsg } = require('../utils');
const { parseAddr } = require('common.utils');
const { getGroupFromCache } = require('../groups');
const { updateContactStatus } = require('./db');

/**
 * 初始化联系人缓存
 */
function initAppContactCaches() {
  if (!App.contacts) {
    App.contacts = {
      list: [],
      map: {}
    };
  }
}

exports.initAppContactCaches = initAppContactCaches;

/**
 * 缓存联系人
 * @param {Object} newUser  被缓存的用户对象
 * @param {Boolean} isRewrite  是否重写指定用户
 */
function cacheContact(newUser, isRewrite = false) {
  const contacts = App.contacts;

  const oldUser = contacts.map[newUser.publicKey];

  if (!oldUser) {
    contacts.list.push(newUser);
    contacts.map[newUser.publicKey] = newUser;
  } else {
    if (isRewrite) {
      contacts.list[contacts.list.indexOf(oldUser)] = newUser;
    }
  }
}

exports.cacheContact = cacheContact;

/**
 * 从缓存中获取联系人信息
 * @param {String} publicKey 联系人的唯一标识，publicKey
 */
function getContactFromCache(publicKey) {
  return App.contacts.map[publicKey];
}

exports.getContactFromCache = getContactFromCache;

/**
 * 从缓存中移除指定用户
 * @param {Object} user 用户对象
 */
function removeContactFromCache(user) {
  const contacts = App.contacts;
  const _user = contacts.map[user.publicKey];

  if (_user) {
    contacts.list.splice(contacts.list.indexOf(_user), 1);
    delete contacts.map[user.publicKey];
  }
}

exports.removeContactFromCache = removeContactFromCache;

/**
 * 检查指定用户是否是联系人
 * @param {Object} user
 */
function checkIsContactFromCache(user) {
  const contacts = App.contacts;

  if (contacts.map[user.publicKey]) {
    return true;
  } else {
    return false;
  }
}

exports.checkIsContactFromCache = checkIsContactFromCache;

/**
 * 发送”发起聊天“请求
 * @param {String} receiverPubKey 接收人公钥
 */
function sendInitiatingChatRequest(receiverPubKey, onResponse) {
  const sender = App.user;
  const payload = {
    type: 'Request',
    cmd: 'INITIATING_CHAT',
    msg: {
      sender: {
        nickname: sender.nickname,
        publicKey: sender.publicKey
      }
    }
  };

  let opts = {
    toUser: App.identifiers.MAIN + '.' + receiverPubKey,
    data: JSON.stringify(payload),
    needACK: true,
    needResponse: true,
    retryWaitMS: 5 * 1000,
    onSuccess: () => {},
    onError: () => {
      showTopMsg('request timeout', 3 * 1000);
    },
    onResponse: (src, res) => {
      const resObj = JSON.parse(res);

      if (resObj.error) {
        showTopMsg(resObj.error.text, 3 * 1000);
      } else {
        onResponse && onResponse(src, resObj);
      }
    }
  };

  showTopMsg('initiating chat...', 3 * 1000);
  cmSend(opts);
}

exports.sendInitiatingChatRequest = sendInitiatingChatRequest;

/**
 * 拦截”发起聊天“类型请求
 * @param {String} src 发送人地址
 * @param {Object} res 收到的消息
 */
function handleInitiatingChatRequest(src, res, responseID) {
  const msgSender = res.msg.sender;
  const senderAddr = parseAddr(src);
  let error = null;

  // 检查发起人是否在联系人列表中
  if (!checkIsContactFromCache(msgSender)) {
    error = {
      text: 'Not a cantact.'
    };
  }

  const payload = {
    cmd: 'INITIATING_CHAT',
    msg: {
      sender: {
        nickname: App.user.nickname,
        publicKey: App.user.publicKey
      },
      error: error
    }
  };

  let opts = {
    toUser: App.identifiers.MAIN + '.' + senderAddr.publicKey,
    data: JSON.stringify(payload),
    needACK: true,
    needResponse: false,
    retryWaitMS: 5 * 1000,
    onSuccess: () => {},
    onError: () => {},
    responseID: responseID
  };

  cmSend(opts);

  if (error) {
    return false;
  } else {
    return true;
  }
}

exports.handleInitiatingChatRequest = handleInitiatingChatRequest;

/**
 * 拦截联系人发送的消息，如果对此消息的发送人发出过好友申请，就将“联系人”字段设置为 true
 * @param {Object} result 返回的消息
 */
function handleContactMsg(result) {
  // 如果不是消息类型就跳过
  if (result.cmd !== 'MESSAGE') {
    return;
  }

  const msgGroup = result.msg.group;
  const localGroup = getGroupFromCache(msgGroup.key);

  // 如果本地群组不存在或者群组类型不是只有两个成员的 normal 类型，就跳过
  if (!localGroup || localGroup.type !== 'normal') {
    return;
  }

  const msgSender = result.msg.user;
  const contact = getContactFromCache(msgSender.publicKey);

  // 如果联系人状态待定中就添加为联系人
  if (contact && contact.status === 'waiting') {
    updateContactStatus(App.db, contact.publicKey, 'allow');
    contact.status = 'allow';
  }
}

exports.handleContactMsg = handleContactMsg;
