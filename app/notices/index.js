/***
 * 通知相关
 */

const uuidv1 = require('uuid/v1');
const { NoticeListModal } = require('../modals/notice-list');
const noticedb = require('./db');
const utils = require('../utils');

/**
 * 通知类型，新联系人
 */
exports.NOTICE_TYPE_NEW_CONTACT = 'notice:new_contact';
/**
 * 通知类型，群组添加新成员请求
 */
exports.NOTICE_TYPE_NEW_GROUP_MEMBER = 'notice:new_group_member';

/**
 * 初始化通知模块
 */
function initAppNoticeModule() {
  initAppNoticeCaches();
  bindEvent_showNoticeListModal();
}

exports.initAppNoticeModule = initAppNoticeModule;

/**
 * 初始化通知消息缓存
 */
function initAppNoticeCaches() {
  if (!App.notices) {
    App.notices = {
      list: [],
      map: {}
    };
  }
}

exports.initAppNoticeCaches = initAppNoticeCaches;

/**
 * 缓存通知
 * @param {Object} newNotice  被缓存的通知对象
 * @param {Boolean} isRewrite  是否重写指定通知
 */
function cacheNotice(newNotice, isRewrite = false) {
  const notices = App.notices;
  const oldNotice = notices.map[newNotice.id];

  if (!oldNotice) {
    notices.list.push(newNotice);
    notices.map[newNotice.id] = newNotice;
  } else {
    if (isRewrite) {
      notices.list[notices.list.indexOf(oldNotice)] = newNotice;
    }
  }
}

exports.cacheNotice = cacheNotice;

/**
 * 从缓存中移除指定通知
 * @param {Object} notice 通知对象
 */
function removeNoticeFromCache(notice) {
  const notices = App.notices;
  const _notice = notices.map[notice.id];

  if (_notice) {
    notices.list.splice(notices.list.indexOf(_notice), 1);
    delete notices.map[notice.id];
  }
}

exports.removeNoticeFromCache = removeNoticeFromCache;

/**
 * 创建“添加联系人”通知信息
 * @param {Object} options 配置项
 */
function createAddGroupMemberNotice(options) {
  const noticePayload = {
    msgKey: options.msgKey, // 添加群成员类型消息的唯一标识
    group: options.group,
    inviter: options.inviter, // 邀请人
    invitee: options.invitee // 被邀请人
  };

  const notice = noticedb.addNewNotice(
    App.db,
    options.key ? options.key : uuidv1(),
    exports.NOTICE_TYPE_NEW_GROUP_MEMBER,
    noticePayload,
    options.status ? options.status : 'waiting'
  );
  cacheNotice(notice);

  return notice;
}

exports.createAddGroupMemberNotice = createAddGroupMemberNotice;

/**
 * 创建“添加联系人”通知信息
 * @param {Object} options 配置项
 */
function createAddContactNotice(options) {
  const noticePayload = {
    sender: options.sender,
    receiver: options.receiver
  };

  const notice = noticedb.addNewNotice(
    App.db,
    options.key ? options.key : uuidv1(),
    exports.NOTICE_TYPE_NEW_CONTACT,
    noticePayload,
    options.status ? options.status : 'waiting'
  );
  cacheNotice(notice);

  return notice;
}

exports.createAddContactNotice = createAddContactNotice;

/**
 * 发送添加联系人请求
 * @param {String} publicKey 被添加联系人的公钥
 */
function sendAddContactResponse(publicKey, notice) {
  const sender = App.user;
  const payload = {
    type: 'Request',
    cmd: 'ADD_CONTACT_RESPONSE',
    msg: {
      sender: {
        nickname: sender.nickname,
        publicKey: sender.publicKey
      },
      notice: {
        key: notice.key,
        type: notice.type,
        payload: notice.payload,
        status: notice.status,
        createTime: notice['create_time']
      }
    }
  };

  let opts = {
    toUser: `${App.identifiers.MAIN}.${publicKey}`,
    data: JSON.stringify(payload),
    needACK: true,
    needResponse: false,
    onSuccess: () => {},
    onError: () => {}
  };
  utils.cmSend(opts);
}

exports.sendAddContactResponse = sendAddContactResponse;

/**
 * 绑定事件，显示通知列表弹出层
 */
function bindEvent_showNoticeListModal() {
  $(document).on('click', '#btn--show-notice-modal', function() {
    new NoticeListModal().render();
  });
}

exports.bindEvent_showNoticeListModal = bindEvent_showNoticeListModal;
