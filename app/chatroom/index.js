/**
 * chatroom 相关
 *
 * 使用聊天室面板组件（chat-panel）构建群组聊天界面
 * 集成聊天室客户端组件（chatroom-client）到当前项目
 */

const nanotime = require('nano-time');

const { dataURItoBlob, createBlobUrl, getUniqueNum } = require('common.utils');
const { getFileDataURL } = require('common.utils/file');
const {
  createDownloadTask,
  getDownloadTask
} = require('common.download/download-task');
const { Nav } = require('common.ui-components/nav');
const { Chatroom } = require('common.ui-components/chatroom');
const { MessageItem } = require('common.ui-components/chat-panel');
const { chatroomConstants } = require('common.ui-components/chatroom/utils');
const { ArticlePage } = require('common.ui-components/article/article');
const {
  EditArticlePage
} = require('common.ui-components/article/edit-article');
const {
  ImagePreviewModal
} = require('common.ui-components/image-preview/image-preview');
const {
  getMessageItemConfig
} = require('common.ui-components/chatroom/message-configs');

const App = require('../store');
const dbCore = require('../db');
const utils = require('../utils');
const { renderGUIGroupListItem, sendMsg } = require('../im-actions');
const { popupForwordMenu } = require('../contextmenu/forword-message');
const { ForwordMessageModal } = require('../modals/forword-message');
const { getMsgCachedData } = require('./db');

/**
 * 展示聊天室 按钮点击事件
 */
function onShowChatPanelBtnClick(group) {
  $('[data-target="#tab__message"]').trigger('click');
  renderGUIGroupListItem(group, true);
  $(`[data-target="#tab__message__group${group.id}"]`).trigger('click');
}

exports.onShowChatPanelBtnClick = onShowChatPanelBtnClick;

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

/**
 * 创建聊天室面板
 */
function createChatroomPanel() {
  const _consts = chatroomConstants;
  const chatroomPanel = new Chatroom();

  __bindEvent_onChatroomRendered();

  // 绑定事件，聊天室渲染完成事件
  function __bindEvent_onChatroomRendered() {
    // 绑定自定义 onrendered 事件
    chatroomPanel.$on('rendered', () => {
      __bindEvent_onSendMessage();
      __bindEvent_onShowEditArticlePage();
      __bindEvent_onItemMessageClick();
      bindEvent_loadOldMessagesOnScroll(chatroomPanel);
    });
  }
  /**
   * 绑定事件，聊天室发送消息事件
   */
  function __bindEvent_onSendMessage() {
    const user = App.user;

    chatroomPanel.on(_consts.EVENT_SEND_MESSAGE, (_, event, data) => {
      // 阻止事件继续向上冒泡
      event.stopPropagation();
      const group = chatroomPanel.group;
      utils.log('sendmessage, data', data);

      (async () => {
        let microTimestamp, msgKey;

        microTimestamp = nanotime.micro();
        msgKey = user.publicKey.slice(-10) + microTimestamp;

        const msg = {
          key: msgKey,
          group: {
            title: group['title'],
            key: group['key']
          },
          user: {
            nickname: user['nickname'],
            publicKey: user['publicKey']
          },
          message: null,
          timestamp: microTimestamp
        };

        const info = data.info;

        switch (data.type) {
          case 'image': {
            const dataURL = info.dataUrl;
            const thumbResult = await utils.getImageThumbnail(dataURL);

            msg.message = {
              type: 'image',
              info: {
                name: info.name,
                ext: info.ext,
                size: info.size,
                len: dataURL.length,
                thumbnail: thumbResult.data,
                md5sum: info.md5sum,
                isLazyMode: true
              }
            };
            break;
          }

          case 'file': {
            const dataURL = info.dataUrl;

            msg.message = {
              type: 'file',
              info: {
                name: info.name,
                ext: info.ext,
                size: info.size,
                len: dataURL.length,
                md5sum: info.md5sum,
                isLazyMode: true
              }
            };
            break;
          }

          case 'article': {
            const dataURL = info.dataUrl;

            msg.message = {
              type: 'article',
              info: {
                name: info.name,
                ext: info.ext,
                size: info.size,
                len: dataURL.length,
                md5sum: info.md5sum,
                isLazyMode: true,
                thumbnail: info.thumbnail
              }
            };
            break;
          }

          default: {
            msg.message = data;
            break;
          }
        }

        // 获取 MessageItem 配置项
        let itemConfig = getMessageItemConfig({
          pos: 'right',
          user: App.user,
          message: data,
          timestamp: msg.timestamp
        });

        itemConfig.key = msgKey;
        itemConfig.group = group;
        App.messageKeyMap[msgKey] = 1;

        const item = new MessageItem(itemConfig);

        bindEvent_onMessageItemRendered(chatroomPanel, item);
        // 绑定右键菜单事件
        bindEvent_onMessageContextMenu(item);

        // 如果是图片类型消息，就缓存用于预览的图片信息
        if (msg.message.type === 'image') {
          createAndAddImageInfo(item, data.info, group);
        }

        // 当 message item 渲染完成后执行发送消息事件
        item.$on('rendered', () => {
          const payload = {
            cmd: 'MESSAGE',
            msg: msg
          };
          try {
            const info = data.info;

            /** 将消息 Graph 的 Parent 插入到消息中 */
            App.messageGraphManger.sendMsgHookForGraph(group['key'], payload);
            dbCore.cacheMessage(App.db, group['key'], payload, info.dataUrl);

            // 如果消息类型不是文本类型，就为其添加 dataID 属性
            if (data.type !== 'text') {
              const cacheOpts = {
                md5: info.md5sum,
                length: info.len,
                size: info.size,
                content: info['dataUrl']
              };
              const dataID = dbCore.cacheMessageData(
                App.db,
                cacheOpts,
                group['key'],
                msgKey
              );

              msg.message.info.dataID = dataID;

              const task = createDownloadTask({
                cm: App.cm,
                serverAddr: `${App.identifiers.MAIN}.${App.user.publicKey}`,
                md5: info.md5sum || item.config.key,
                dataInfo: {
                  dataID: dataID,
                  msgKey: item.config.key,
                  payloadLength: info.len
                },
                dataURL: info['dataUrl']
              });

              item.config.task = task;
            }
          } catch (error) {
            console.log('cacheMessage', error);
          }

          // 发送消息
          sendMsg(group, payload);
        });

        // 添加到聊天室面板
        chatroomPanel.addMessageItems([item]);
        chatroomPanel.chatPanel.scrollToBottom();
        renderGUIGroupListItem(group, true);
      })();
    });
  }

  /**
   * 绑定事件，展示文章编辑页面事件
   */
  function __bindEvent_onShowEditArticlePage() {
    chatroomPanel.on(_consts.EVENT_SHOW_EDIT_ARTICLE_PAGE, (_, event, data) => {
      const nav = chatroomPanel.getNav();

      let page = nav.getPage('edit_article_page');

      if (!page) {
        page = new EditArticlePage({ title: 'New Article' });
        // 添加到导航组件
        nav.push('edit_article_page', page);

        // 绑定发布文章事件
        page.on(page.constants.EVENT_PUBLISH, (_, event, message) => {
          // 阻止事件继续冒泡
          event.stopPropagation();
          // 触发发送消息事件
          chatroomPanel.trigger(_consts.EVENT_SEND_MESSAGE, message);
          // 切换导航页面到聊天室面板
          nav.navTo('chatroom-panel');
        });
      }

      nav.navTo('edit_article_page');
    });
  }

  function _doBroadcast(cm, user, msg) {
    return new Promise(resolve => {
      cm.sendMessage(
        user,
        JSON.stringify(msg),
        true,
        true,
        3,
        3000,
        () => {},
        err => {
          // console.log(err);
          resolve(false);
        },
        (src, decryptedMsg) => {
          if (decryptedMsg) {
            let msg = JSON.parse(decryptedMsg);
            resolve(msg['status']);
          } else {
            resolve(false);
          }
        }
      );
    });
  }

  /**
   * 广播获取存在消息数据的用户列表
   * @param {*} cm 通讯模块
   * @param {*} users 群组用户列表
   * @param {*} key 消息标识符
   */
  async function _getMsgDatBroadcast(cm, users, key) {
    // console.log('_getMsgDatBroadcast', users);

    let result = {};
    let msg = {
      cmd: 'GET_MSG_DAT_BC',
      type: 'Request',
      msgKey: key
    };

    for (var user of users) {
      let response = await _doBroadcast(cm, user, msg);
      // console.log('_doBroadcast', user, msg, response);
      if (response) {
        result[user] = true;
      }
    }

    return result;
  }

  /**
   * 绑定事件，消息实体被点击事件
   */
  function __bindEvent_onItemMessageClick() {
    chatroomPanel.on(_consts.EVENT_CLICK_ITEM_MESSAGE, (_, event, data) => {
      event.stopPropagation();
      utils.log('__bindEvent_onItemMessageClick', _, event, data);
      const item = data.item;
      const itemConfig = item.config;
      const message = itemConfig.message;
      const info = message.info;

      if (itemConfig.type === 'text') {
        return;
      }

      let groupKey = item.config.group.key;
      let groupMembers = App.groupManger[groupKey];

      // 从本地数据库获取缓存数据
      let getDataFromDBCache = repairMessageData(item)
      // console.log("getDataFromDBCache",getDataFromDBCache);
      if (!getDataFromDBCache) {
        item.setStatus('load', `waiting ...`);
      }


      // 如果当前 message item 处于懒加载模式，就创建下载任务
      const task = createDownloadTask({
        cm: App.cm,
        serverAddr: groupMembers,
        md5: info.md5sum || itemConfig.key,
        dataInfo: {
          msgKey: itemConfig.key,
          payloadLength: info.len
        },
        dataURL: itemConfig.isLazyMode ? null : info['dataUrl'],
        source: `${App.identifiers.MAIN}.${itemConfig.user.publicKey}`
      });

      if (!itemConfig.task) {
        itemConfig.task = task;

        // 绑定进度提醒回调事件
        task.on(task.EVENT_PROGRESS, value => {
          utils.log('EVENT_PROGRESS', value);
          item.setStatus('load', `${((value / 1) * 100).toFixed(2)}%`);
        });

        // 绑定下载完成回调事件
        task.on(task.EVENT_DONE, __onTaskDone);

        // 绑定下载失败回调事件
        task.on(task.EVENT_FAIL, (sliceNum, error) => {
          if (item.status == 'done') {
            return;
          }

          utils.log('EVENT_FAIL', sliceNum, error);
          item.setStatus('fail');
        });
      }

      if (item.config.type === 'article') {
        // 展示文章页面
        _showArticlePage(chatroomPanel.getNav(), item.config.message, task);
      }

      if (getDataFromDBCache) {
        task.config.serverAddr = task.config.source;
        task.start();
      } else {
        _getMsgDatBroadcast(App.cm, groupMembers, itemConfig.key).then(res => {
          let _users = Object.keys(res);
          // console.log('_getMsgDatBroadcast then', res, _users);
          if (_users.length > 0) {
            task.config.serverAddr = _users;
          } else {
            task.config.serverAddr = task.config.source;
          }

          // console.log('start', task.config);
          task.start();
        });
      }

      // 如果为图片类型消息并且此时未弹出图片预览窗口
      if (item.config.type === 'image' && !window.isImageModalVisible) {
        _showImagePreviewModal(chatroomPanel, item, task);
      }

      function __onTaskDone(dataURL) {
        utils.log('EVENT_DONE', dataURL.length, item);

        // if (!itemConfig.isLazyMode) {
        //   return;
        // }

        item.setStatus('done');
        itemConfig.isLazyMode = false;
        itemConfig.imgInfo && (itemConfig.imgInfo.imgSrc = dataURL);
        info['dataUrl'] = dataURL;
        info['isLazyMode'] = false;

        const resultData = task.resultData;

        if (resultData) {
          info['dataID'] = resultData['dataID'];
          info['md5sum'] = resultData['md5sum'];
          info['size'] = resultData['size'];
          info['len'] = resultData['len'];

          const cacheOpts = {
            md5: info['md5sum'],
            length: info.len,
            size: info.size,
            content: dataURL
          };
          dbCore.cacheMessageData(
            App.db,
            cacheOpts,
            itemConfig.group.key,
            itemConfig.key
          );
        }

        switch (item.config.type) {
          case 'image': {
            // 生成 blob URL
            const blob = dataURItoBlob(dataURL);
            const blobURL = createBlobUrl(blob);

            item.$elem.find('.item-message--image').attr('src', blobURL);

            break;
          }

          case 'article': {
            item.$elem
              .find('.icon-uic-cloud-dl')
              .removeClass('icon-uic-cloud-dl')
              .addClass('icon-uic-article');

            break;
          }

          case 'file': {
            // 生成 blob URL
            const blob = dataURItoBlob(dataURL);
            const blobURL = createBlobUrl(blob);

            item.$elem.find('.item-message').attr('href', blobURL);

            item.$elem
              .find('.icon-uic-cloud-dl')
              .removeClass('icon-uic-cloud-dl')
              .addClass('icon-uic-folder');

            break;
          }

          default:
            break;
        }
      }
    });
  }

  return chatroomPanel;
}

exports.createChatroomPanel = createChatroomPanel;

/**
 * 展示文章页面
 * @param {Nav} nav
 * @param {Object} message
 */
function _showArticlePage(nav, message, task) {
  const pageName = `read_article_${getUniqueNum()}`;
  const articlePage = new ArticlePage({ info: message.info });

  nav.push(pageName, articlePage).navTo(pageName);
  // 绑定进度提醒回调事件
  task.on(task.EVENT_PROGRESS, value => {
    utils.log('EVENT_PROGRESS', value);
    articlePage.loading.updateText(`${((value / 1) * 100).toFixed(2)}%`);
  });
  // 绑定下载完成回调事件
  task.on(task.EVENT_DONE, dataURL => {
    message.info['dataUrl'] = dataURL;
    articlePage.loading.remove();
  });

  return articlePage;
}

/**
 * 展示图片预览模态框
 * @param {Chatroom} chatroomPanel
 * @param {MessageItem} item
 */
function _showImagePreviewModal(chatroomPanel, item, task) {
  const imagePreviewModal = new ImagePreviewModal({
    imgInfoList: chatroomPanel.imgInfoList,
    currentInfo: item.config.imgInfo
  });

  // 绑定自定义事件，弹出层创建成功后将全局标志位设置为 true
  imagePreviewModal.$on('create', () => {
    window.isImageModalVisible = true;
  });

  // 绑定自定义事件，弹出层关闭后将全局标志位设置为 false
  imagePreviewModal.$on('closed', () => {
    window.isImageModalVisible = false;
  });

  // 绑定自定义事件，图片预览 item create 函数被调用时触发
  imagePreviewModal.$on('item-create', previewItem => {
    const imgInfo = previewItem.config.imgInfo;
    // 为 item 绑定 onCreated 事件
    // 读取图片下载任务，更新下载进度、下载完成后替换预览图为完整图片
    previewItem.$on('created', () => {
      // 图片被预览时触发图片消息的点击事件，此时会触发消息的下载任务
      imgInfo.item.$elem.find('.item-message--image').trigger('click');

      // 从本地数据库获取缓存数据
      // repairMessageData(item);

      // 通过 md5 读取下载任务
      // const task = createDownloadTask({
      //   cm: App.cm,
      //   serverAddr: `${App.identifiers.MAIN}.${imgInfo.publicKey}`,
      //   md5: imgInfo.md5sum || imgInfo.msgKey,
      //   dataInfo: {
      //     dataID: imgInfo.dataID,
      //     msgKey: imgInfo.msgKey,
      //     payloadLength: imgInfo.len
      //   },
      //   dataURL: imgInfo['dataUrl']
      // });

      // utils.log('image preview item task', task);

      if (!previewItem.task) {
        previewItem.task = task;
        // 绑定下载进度回调事件，更新图片预览“下载进度条”
        task.on(task.EVENT_PROGRESS, __onProgress);
        // 绑定下载完成事件，更新预览图为完整图片
        task.on(task.EVENT_DONE, __onDone);
        // release 事件被触发时解绑下载任务回调
        previewItem.$on('release', () => {
          task.off(task.EVENT_PROGRESS, __onProgress);
          task.off(task.EVENT_DONE, __onDone);
        });
      }

      // task.start();

      /**
       * 下载进度回调
       * @param {Number} value
       */
      function __onProgress(value) {
        previewItem.updateLoad(value);
      }

      /**
       * 下载完成回调
       * @param {Stirng} dataURL
       */
      function __onDone(dataURL) {
        previewItem.updateImage(dataURL);
      }
    });
  });

  // 渲染图片预览弹出层
  imagePreviewModal.render();
}

/**
 * 创建图片预览信息并添加到指定图片预览列表
 * @param {Object} itemConfig
 * @param {Object} msgInfo
 */
function createAndAddImageInfo(item, msgInfo, group) {
  const itemConfig = item.config;
  const imgInfo = {
    item: item,
    msgKey: itemConfig.key,
    publicKey: itemConfig.user.publicKey,
    dataID: msgInfo.dataID,
    md5sum: msgInfo.md5sum,
    preview: msgInfo.thumbnail,
    payloadLength: msgInfo.len,
    imgSrc: msgInfo.isLazyMode ? null : msgInfo.dataUrl
  };

  itemConfig.imgInfo = imgInfo;

  // 将图片预览信息添加到相应聊天页面的“预览图片列表”中
  App.groupIdMap[group.id].chatroomPanel.addImgInfo(imgInfo);
}

exports.createAndAddImageInfo = createAndAddImageInfo;

/**
 * 绑定事件，消息被触发右键菜单事件
 * @param {MessageItem} item
 */
function bindEvent_onMessageContextMenu(item) {
  if (item.isRendered) {
    // 已经渲染完成，直接绑定事件
    __bind();
  } else {
    // 待渲染完毕后再绑定事件
    item.$on('rendered', item => {
      __bind();
    });
  }

  /**
   * 绑定事件
   */
  function __bind() {
    item.$elem.on('contextmenu', '.item-message', function() {
      repairMessageData(item);

      popupForwordMenu({
        onClick() {
          const isLazyMode = item.config.isLazyMode;

          if (isLazyMode) {
            alert('Please download the message at first。');
            return;
          }

          new ForwordMessageModal({
            message: item.config.message
          }).render();
        }
      });
    });
  }
}

exports.bindEvent_onMessageContextMenu = bindEvent_onMessageContextMenu;

/**
 * 修复消息数据
 *
 * 为缩略版消息填充完整消息数据
 * @param {MessageItem} item
 */
function repairMessageData(item) {
  const itemConfig = item.config;

  if (itemConfig.isCacheMsg && itemConfig.isLazyMode) {
    const msgInfo = itemConfig.message.info;

    // 获取本地完整消息缓存
    const cachedData = getMsgCachedData(App.db, item);

    if (cachedData) {
      // 填充完整消息信息
      msgInfo.md5sum = cachedData['md5sum'];
      msgInfo.len = cachedData['length'];
      msgInfo.size = cachedData['size'];
      msgInfo.dataUrl = cachedData['content'];
      msgInfo.isLazyMode = false;
      itemConfig.isLazyMode = false;

      const imgInfo = itemConfig.imgInfo;
      // 更新图片预览信息
      if (imgInfo) {
        imgInfo.md5sum = cachedData['md5sum'];
        imgInfo.len = cachedData['length'];
        imgInfo.size = cachedData['size'];
        imgInfo.dataUrl = cachedData['content'];
      }
    } else {
      return false;
    }
  }

  return true;
}

/**
 * 绑定事件，当消息渲染完成
 * @param {Chatroom} chatroomPanel
 * @param {MessageItem} item
 */
function bindEvent_onMessageItemRendered(chatroomPanel, item) {
  item.$on('rendered', () => {
    __addAttrToItem();

    // 如果是已渲染的最后一条消息就根据消息方向渲染指定界面效果
    // if (__isLastItem(item)) {
    //   const chatPanel = chatroomPanel.chatPanel;

    //   if (item.config.pos === 'right' || !chatPanel.isReadingMode()) {
    //     // 如果是主动发出的消息或者用户未处于阅读历史消息状态
    //     // 就将滚动条滚动到最底部
    //     chatPanel.scrollToBottom();
    //   } else {
    //     // 显示“新消息”提示
    //     chatPanel.editor.nodes.$editorTip.removeClass('uic-hide');
    //   }
    // }
  });

  /**
   * 消息渲染完成后为其添加自定义属性
   */
  function __addAttrToItem() {
    // 添加 msg key 属性到消息元素上
    item.$elem.attr('data-key', item.config.key);
  }

  /**
   * 是否是已渲染的最后一条消息
   * @param {MessageItem} item
   */
  function __isLastItem(item) {
    return item.$elem.next().length === 0;
  }
}

exports.bindEvent_onMessageItemRendered = bindEvent_onMessageItemRendered;

/**
 * 根据收到的消息渲染消息对象
 * @param {Object} msg  消息数据
 */
function createMessageItemByMsg(msg) {
  // 根据 message 信息获取 MessageItem 配置项
  const groupData = App.groupMap[msg.group.key];
  const itemConfig = getMessageItemConfig({
    pos: msg.user.publicKey === App.user.publicKey ? 'right' : 'left',
    user: msg.user,
    message: msg.message,
    timestamp: msg.timestamp
  });

  itemConfig.key = msg.key;
  itemConfig.group = groupData;
  itemConfig.parents = msg.parents;
  itemConfig.isCacheMsg = msg.isCacheMsg;

  const item = new MessageItem(itemConfig);
  const chatroomPanel = App.groupIdMap[groupData.id].chatroomPanel;

  item.chatPanel = chatroomPanel.chatPanel;
  bindEvent_onMessageItemRendered(chatroomPanel, item);
  // 绑定右键菜单事件
  bindEvent_onMessageContextMenu(item);

  // 如果是图片类型消息，就缓存用于预览的图片信息
  if (msg.message.type === 'image') {
    createAndAddImageInfo(item, msg.message.info, groupData);
  }

  return item;
}

exports.createMessageItemByMsg = createMessageItemByMsg;

/**
 * 绑定事件，触发时加载历史消息
 */
function bindEvent_loadOldMessagesOnScroll(chatroomPanel) {
  const group = chatroomPanel.group;
  const chatPanel = chatroomPanel.chatPanel;
  const $messagePanel = chatPanel.messagePanel.$elem;
  let isLoading = false;
  let isLoadDone = false;
  let timer = null;

  $messagePanel.on('scroll mousewheel', __bind);

  function __bind(event) {
    __removeItemHighlight();
    // 如果未滚动到顶部或者正处于加载状态就跳过
    if (!isLoadDone && $messagePanel.scrollTop() === 0 && !isLoading) {
      isLoading = true;

      const firstMsgKey = $messagePanel
        .find('.uic__message-item')
        .eq(0)
        .data('key');
      const payloads = App.messageGraphManger.getLastCachedMessages(
        group.key,
        firstMsgKey
      );

      // 如果已经加载完毕所有缓存消息
      if (payloads.length === 0) {
        isLoadDone = true;
        return;
      }

      payloads.reverse();
      const itemList = [];
      utils.log('bindEvent_loadOldMessagesOnScroll', payloads);

      for (let payload of payloads) {
        if (payload.cmd !== 'MESSAGE') {
          continue;
        }
        App.messageKeyMap[payload.msg.key] = 1;
        const item = createMessageItemByMsg(payload.msg);
        itemList.push(item);
      }

      // 在列表顶部追加消息
      chatroomPanel.addMessageItems(itemList, true);

      isLoading = false;
    }
  }

  /**
   * 移除可视区域内 message item 的高亮背景
   */
  function __removeItemHighlight() {
    if (timer) {
      return;
    }

    __run();

    function __run() {
      timer = setTimeout(() => {
        const _list = App.missedMessageItemList;

        for (let item of _list) {
          // 如果消息在可视区域内
          if (__isInView(item.$elem)) {
            // 一秒后移除特殊背景 css
            setTimeout(() => {
              item.$elem.removeAttr('style');
            }, 1000);
            // 从列表中移除
            _list.splice(_list.indexOf(item), 1);
          }
        }

        timer = null;
      }, 300);
    }

    /**
     * 判断 item 的元素是否在可视区域内
     * @param {jQuery} $elem
     */
    function __isInView($elem) {
      // 消息距离顶部的高度
      const offsetTop = $elem.offset().top;
      // 消息面板的高度
      const panelHeight = $elem
        .parent()
        .parent()
        .height();

      return offsetTop > 0 && offsetTop < panelHeight + $elem.height();
    }
  }
}

// 丢失消息队列
let _missMessageQueue = [];
/**
 * 未读消息回调函数
 */
function missingMsgsUICallback(msgPayload) {
  utils.log('missingMsgsUICallback', msgPayload);

  const groupKey = msgPayload.msg.group.key;
  const msg = msgPayload.msg;

  // 记录消息标志位，表示已经收到过该消息
  if (App.messageKeyMap[msg.key]) {
    return;
  } else {
    App.messageKeyMap[msg.key] = true;
  }

  let graph = App.messageGraphManger.graphs[groupKey];
  const nextItemKey = graph.successors(msg.key);
  utils.log('_missMessageQueue', _missMessageQueue, nextItemKey);

  // 添加到消息快照
  App.messageGraphManger.insertToMsgSnapshot(groupKey, msg.key, nextItemKey);

  const group = App.groupMap[groupKey];
  // 添加到缓存队列

  _missMessageQueue.push({
    group: group,
    cmd: msgPayload.cmd,
    msg: msgPayload.msg,
    nextItemKey: nextItemKey
  });

  if (msgPayload.cmd === 'COMMAND') {
    App.fn.bindEvent_On_ImMsg(msgPayload.msg.user.publicKey, msgPayload);
    // App.fn.onCMDMemberStatus(msgPayload);
  }

  for (let qitem of _missMessageQueue) {
    __insert(qitem);
  }

  function __insert(queueItem) {
    const $nextItem = $(`#tab__message__group${queueItem.group.id}`).find(
      `[data-key="${queueItem.nextItemKey}"]`
    );

    // 如果页面上存在下一条消息，就将此条消息填充到下一条消息之前
    if ($nextItem.length > 0) {
      const $tempDiv = $('<div></div>');

      switch (queueItem.cmd) {
        case 'MESSAGE': {
          const item = createMessageItemByMsg(queueItem.msg);
          // message item 渲染完成后为其绑定点击事件
          item.$on('rendered', () => {
            const chatroomPanel =
              App.groupIdMap[queueItem.group.id].chatroomPanel;
            chatroomPanel.bindEvent_onItemMessageClick(item);
          });
          __bindEvent_highlightOnItemRendered(item);
          item.render($tempDiv);
          // 添加到界面
          $nextItem.before($tempDiv.children());
          // 移除队列中已渲染的消息
          _missMessageQueue.splice(_missMessageQueue.indexOf(queueItem), 1);
          // 记录渲染后的 message item
          App.missedMessageItemList.push(item);

          break;
        }
        case 'COMMAND': {
          $tempDiv.append(`
            <div
              class="uic__message-item empty-message-item"
              data-key="${queueItem.msg.key}"
              data-is-cmd="true"
              >
            </div>`);

          $nextItem.before($tempDiv.children());
          break;
        }
      }
    }
  }

  /**
   * 返回消息的时间戳
   */
  function __getMessageTime($item) {
    return $item.get(0).comp.item.config.message.timestamp;
  }

  /**
   * 当 item 渲染完成后为其添加高亮背景，表示该消息未读
   * @param {MessageItem} item
   */
  function __bindEvent_highlightOnItemRendered(item) {
    // 监听自定义事件
    item.$on('rendered', () => {
      item.$elem.css('background', '#f7f7f7');
    });
  }
}

exports.missingMsgsUICallback = missingMsgsUICallback;
