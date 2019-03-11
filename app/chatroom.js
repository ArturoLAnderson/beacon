const { Nav } = require('common.ui-components/nav');
const { getFileDataURL } = require('common.utils/file');

const chatroomStore = require('chatroom-client/store').store;
const { createNavPanel } = require('chatroom-client/app/app-controller');
const { CommunicateModule } = require('common.communicate/communicate');
const { cmOnRecv } = require('chatroom-client/app/app-controller');

const App = require('./store');
const dbCore = require('./db');
const utils = require('./utils');
const { dbTools, renderGUIGroups } = require('./im-actions');

/**
 * 初始化聊天室模块
 */
function initChatroomModule(appStore) {
  // 同步 chat p2p 项目中的用户数据到聊天室模块
  chatroomStore.user = Object.assign(chatroomStore.user, appStore.user);

  const cm = new CommunicateModule();

  cm.createClient(
    chatroomStore.identifiers.main,
    10000 /* 重试次数 */,
    100 /* 重试间隔 ms */,
    client => {
      /* 创建成功回调 */
      console.log('createCM', '通讯模块 OK');
      chatroomStore.clientMap.main = cm;
    },
    () => {
      /* 创建失败回调 */
      alert('通讯模块创建失败，请检查您的网络状况');
    },
    appStore.user.privateKey,
    null
  );

  cm.reviceMessage(
    (src, id, decryptedMsg, needResponse, offset, count, total) => {
      cmOnRecv(src, JSON.parse(decryptedMsg));
    }
  );
}

exports.initChatroomModule = initChatroomModule;

function createChatroom(target, serverPublicKey) {
  // 从 URL 中获取服务器公钥
  const _store = chatroomStore;

  // _store.serverPublicKey = serverPublicKey;
  // 生成供 NKN Client 消息收发使用的地址，如 'chatroom.036b17...98c296'
  const serverAddr = `${_store.identifiers.main}.${serverPublicKey}`;

  // 创建导航组件
  const nav = new Nav();

  nav.serverAddr = serverAddr;
  nav.serverPublicKey = serverPublicKey;

  // 缓存导航组件，用于切换各个页面
  _store.nav = nav;
  // 渲染到浏览器
  nav.render(target);
  // 创建导航面板
  createNavPanel(nav, serverPublicKey, serverAddr);
  // 为编辑器添加截图按钮
  addCaptureBtnToEditor(nav.$elem.find('.uic__chat-panel'));

  return nav;
}

exports.createChatroom = createChatroom;

/**
 * 初始化聊天室模块相关事件
 */
function initChatroomEvents() {
  _bindEvent_onAddChatroomBtnClick();
  _bindEvent_onShowChatPanelBtnClick();
}

exports.initChatroomEvents = initChatroomEvents;

/**
 * 绑定事件，添加聊天室 按钮点击事件
 */
function _bindEvent_onAddChatroomBtnClick() {
  /**
   * 弹出层中 添加聊天室 按钮点击事件
   */
  $('#btn--control-add-chatroom').on('click', function() {
    const $btn = $(this);
    const publicKey = $btn
      .parent()
      .find('.search-public-key')
      .val();

    // 输入公钥长度判断
    if (publicKey.length !== 66) {
      alert('Incorrect address length.');
      return;
    }

    const tempTitle = utils.formatPublicKey(publicKey);

    dbCore.addChatroom(App.db, publicKey, tempTitle);

    renderGUIChatrooms();
    $btn.trigger('modal.close');
  });
}

/**
 * 绑定事件，展示聊天室 按钮点击事件
 */
function _bindEvent_onShowChatPanelBtnClick() {
  $(document).on('click', '.btn--control-show-chatroom', function() {
    const id = $(this)
      .closest('.contact__panel')
      .data('itemId');
    const chatroom = dbCore.getChatroomById(App.db, id);
    const group = dbTools._newGroup(App.db, chatroom.title, chatroom.publicKey);
    App.activedGroup = group;

    onShowChatPanelBtnClick(group.id);
  });
}

/**
 * 展示聊天室 按钮点击事件
 * @param {jQuery} $btn
 */
function onShowChatPanelBtnClick(groupId) {
  $('[data-target="#tab__message"]').trigger('click');
  renderGUIGroups();
  $(`[data-target="#tab__message__group${groupId}"]`).trigger('click');
}

exports.onShowChatPanelBtnClick = onShowChatPanelBtnClick;

/**
 * 渲染联系人列表
 */
function renderGUIChatrooms() {
  let html = '';
  let chatrooms = dbCore.getChatrooms(App.db);
  utils.log('renderGUIChatrooms', chatrooms);
  for (let room of chatrooms) {
    html += `
        <div
          class="contact__item outline main__lf__item tab__nav__item is-chatroom"
          data-target="#tab__contact_c${room.id}"
          data-item-id="${room.id}"
          >
            <div class="info">
                <span class="nickname">${room.title}</span><br />
                <small><span class="status"></span>${utils.formatPublicKey(
                  room.publicKey
                )}</small>
            </div>
        </div>
    `;
  }

  $('#tab__contact--chatroom')
    .empty()
    .html(html);
}

exports.renderGUIChatrooms = renderGUIChatrooms;

/**
 * 渲染聊天室信息
 * @param {Number} chatroomId
 */
function renderChatroomInfoPanel(chatroomId) {
  let $infoTab = $('#tab__contact_c' + chatroomId);
  let $panel = $('.app__main__contacts').find('.app__main__rt');
  let chatroom = dbCore.getChatroomById(App.db, chatroomId);

  App.activedUser = chatroom;

  // if (!App.caches['user' + user.id]) {
  //   App.caches['user' + user.id] = {};
  // }

  if ($infoTab.length === 0) {
    let html = `
      <div
        id="tab__contact_c${chatroom.id}"
        data-item-id="${chatroom.id}"
        class="tab__content__pane contact__panel is-chatroom show"
        >
        <div class="form-group no-border">
          <span class="form-group__addon">nickname:</span>
          <input type="text" class="form-group__item" value="${
            chatroom.title
          }" readonly>
        </div>
        <div class="form-group no-border">
          <span class="form-group__addon">Address:</span>
          <input type="text" class="form-group__item copy-input" value="${
            chatroom.publicKey
          }" readonly>
          <span class="form-group__addon">
              <a href="javascript:;" class="btn btn--link btn--control-copy">copy</a>
          </span>
        </div>
        <div style="text-align: center; margin-top: 30px;">
          <a href="javascript:;" class="btn btn--primary btn--control-show-chatroom">Join Chatroom</a>
        </div>
      </div>
    `;

    $panel.children('.show').removeClass('show');
    $panel.append(html);
  }
}

exports.renderChatroomInfoPanel = renderChatroomInfoPanel;

/**
 * 更新 Chatroom 模块当前被激活的 nav（导航组件）
 * @param {Nav} nav
 */
function updateChatroomCurrentNav(nav) {
  chatroomStore.nav = nav;
  chatroomStore.serverAddr = nav.serverAddr;
  chatroomStore.serverPublicKey = nav.serverPublicKey;
}

exports.updateChatroomCurrentNav = updateChatroomCurrentNav;

/**
 * 绑定文本域粘贴事件
 */
function bindEvent_parseToTextarea(editor) {
  editor.on(editor.constants.EVENT_PARSE, function(editor, event, msg) {
    if (msg.type === 'text') {
      editor.insertHtml(msg.data);
    } else if (msg.type === 'image') {
      const file = msg.data;

      getFileDataURL(file).then(dataURL => {
        editor.insertHtml(`
          <img
            src="${dataURL}"
          >
        `);
      });
    }
  });
}

exports.bindEvent_parseToTextarea = bindEvent_parseToTextarea;

/**
 * 绑定文件上传事件
 */
function bindEvent_uploadImage(editor) {
  editor.on(editor.constants.EVENT_UPLOAD_FILE, function(_, event, file) {
    getFileDataURL(file).then(dataURL => {
      editor.insertHtml(`
        <img
          src="${dataURL}"
        >
      `);
    });
  });
}

exports.bindEvent_uploadImage = bindEvent_uploadImage;

/**
 * 为指定编辑器工具栏添加截图按钮
 * @param {Editor} editor
 */
function addCaptureBtnToEditor($editor) {
  $editor.find('.uic__editor__toolbar').append(
    `<a class="uic__editor__toolbar__item btn--capture">
        <i class="iconfont icon-uic-cut"></i>
      </a>
    `
  );
}

exports.addCaptureBtnToEditor = addCaptureBtnToEditor;
