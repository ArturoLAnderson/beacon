const fs = require('fs');
const AppWin = require('electron').remote.getCurrentWindow();

const { Nav } = require('common.ui-components/nav');
const { MessageItem } = require('common.ui-components/chat-panel');
const { DataPanelPage } = require('common.ui-components/data-panel/data-panel');
const { EVENT_CLICK_ITEM } = require('common.ui-components/data-panel/common');
const {
  createChatroomPanel,
  bindEvent_onMessageContextMenu,
  bindEvent_onMessageItemRendered
} = require('./chatroom/index');
const commonUtils = require('common.utils');
const { dataURItoBlob, createBlobUrl, getUniqueNum } = require('common.utils');
const { SliceTaskHandler } = require('common.download/slice');
const messageCache = require('common.messages/message-cache');
const {
  createDownloadTask,
  hasDownloadTask,
  getDownloadTask
} = require('common.download/download-task');
const {
  getMessageItemConfig
} = require('common.ui-components/chatroom/message-configs');
const {
  ImagePreviewModal
} = require('common.ui-components/image-preview/image-preview');
const { ArticlePage } = require('common.ui-components/article/article');

const App = require('./store');
const utils = require('./utils');
const dbCore = require('./db');
const {
  dbTools,
  renderGUIGroups,
  renderGUIGroupListItem,
  broadcastGroupMessages,
  broadcastGroupMemberStatus,
  renderGUIGroupMemberList,
  initGroupMembers
} = require('./im-actions');
const {
  renderChatroomInfoPanel,
  createAndAddImageInfo,
  onShowChatPanelBtnClick
} = require('./chatroom/index');
const { AddMembersModal } = require('./modals/add-members');
const { RemoveMembersModal } = require('./modals/remove-members');
const baseContact = require('./contacts');
const baseGroup = require('./groups');
const baseNotice = require('./notices');
const noticedom = require('./notices/dom');

const ipc = require('electron').ipcRenderer;

// 群组管理
let groupManger = {};
App.groupManger = groupManger;
window.groupManger = groupManger;

/**
 * 绑定事件，当群组收到消息后触发
 * @param {String} src
 * @param {Object} decryptedMsg
 * @param {Number} responseID
 */
function bindEvent_On_ImMsg(src, decryptedMsg, responseID) {
  // 绑定事件，客户端收到消息时触发回调函数
  const result = decryptedMsg;
  const msg = result.msg;
  // 新建分片下任务拦截器
  const sliceTaskHandler = new SliceTaskHandler(App.cm);

  switch (result.cmd) {
    case 'MESSAGE': {
      utils.log('MESSAGE', result);
      baseContact.handleContactMsg(result);

      // 如果在本地未找到该群组，就跳过
      if (!baseGroup.checkIsGroupFromCache(msg.group)) {
        return;
      }

      // 如果已经收到过此消息，就跳过
      if (App.messageKeyMap[msg.key]) {
        return;
      }

      let groupKey = msg.group.key;
      let group = App.groupMap[groupKey];

      // 如果群组不存在就创建群组
      if (!group) {
        group = dbTools._newGroup(App.db, msg.group.title, msg.group.key);
        // 缓存群组信息到内存
        App.groupMap[groupKey] = group;
      }

      App.messageKeyMap[msg.key] = true;
      let res = dbCore.checkMessageIsCached(App.db, msg.key);
      if (!res.exist) {
        // 若数据库中没有该消息需要先存储
        dbCore.cacheMessage(App.db, group['key'], result);
      }

      renderGUIGroupListItem(group, true, true);
      renderGroupChat(group);

      const msgInfo = msg.message.info;

      // 如果已经下载过此 md5 的文件，就填充消息的 dataURL 属性
      // 并将懒加载标志位设置为 false
      if (hasDownloadTask(msgInfo.md5sum)) {
        const dataURL = getDownloadTask(msgInfo.md5sum)['dataURL'];

        msgInfo['dataUrl'] = dataURL;
        msgInfo['isLazyMode'] = false;
      }

      // 根据 message 信息获取 MessageItem 配置项
      const itemConfig = getMessageItemConfig({
        pos: 'left',
        user: msg.user,
        message: msg.message,
        timestamp: msg.timestamp
      });

      itemConfig.key = msg.key;
      itemConfig.group = msg.group;

      const item = new MessageItem(itemConfig);

      const chatroomPanel = App.groupIdMap[group['id']].chatroomPanel;
      bindEvent_onMessageItemRendered(chatroomPanel, item);
      // 绑定右键菜单事件
      bindEvent_onMessageContextMenu(item);

      // 如果是图片类型消息，就缓存用于预览的图片信息
      if (msg.message.type === 'image') {
        createAndAddImageInfo(item, msgInfo, group);
      }

      // 渲染聊天内容到界面
      renderTalks(group, [item]);

      // 如果当前未处于聊天界面就在侧边栏提示有新信息
      if (!$('#tab__message').hasClass('show')) {
        $('#btn--show-message-panel')
          .find('.badge-dot')
          .removeClass('hide');
      }
      break;
    }

    case 'COMMAND': {
      const cmdPayload = JSON.parse(msg.message.info.text);
      switch (cmdPayload.cmd) {
        case 'IM_MEMBER_STATUS': {
          onCMDMemberStatus(result);
          break;
        }
      }
      break;
    }

    // 修改群昵称
    case 'IM_CHANGE_GROUP_TITLE': {
      /**
        {
            cmd: 'IM_CHANGE_GROUP_TITLE',
            msg: {
                group: {
                    title: group.title,
                    key: group.key
                }
            }
        }
        */

      let group = msg.group;
      updateGroupTitle(group.key, group.title);
      break;
    }

    case 'SLICE_DOWNLOAD': {
      // 如果存在 responseID，表示需要返回一个 Response，否则忽略
      if (responseID) {
        // 拦截收到的信息，如果 payload.cmd === sliceTaskHandler.cmd，就进入切片下载任务回调
        sliceTaskHandler.handle(decryptedMsg, msg => {
          let msgDataInfo = {};

          if (msg.dataInfo.msgKey) {
            const result = messageCache.getMessageDataInfoByKey(App.db, {
              messageTable: 'im_messages',
              dataTable: 'im_message_data',
              msgKey: msg.dataInfo.msgKey
            });

            msgDataInfo.dataID = result['data_id'];
            msgDataInfo.len = result['length'];
            msgDataInfo.size = result['size'];
            msgDataInfo.md5sum = result['md5sum'];
            msg.dataInfo.dataID = result['data_id'];
          }

          // 获取分片信息
          const res = messageCache.getMessageSlice(
            App.db,
            msg.dataInfo.dataID,
            msg.offset,
            msg.limit,
            'im_message_data'
          );

          // 如果分片信息不存在就在 Response 中指定错误信息
          if (!res.status) {
            sliceTaskHandler.response(src, responseID, null, res.errMsg);
          } else {
            sliceTaskHandler.response(
              src,
              responseID,
              Object.assign(res.slice, msgDataInfo),
              null
            );
          }
        });
      }
      break;
    }

    default:
      break;
  }

  // 聊天消息类型，命令消息类型
  const cmdTypes = ['MESSAGE', 'COMMAND'];

  // 图模块仅接受聊天消息、命令消息两种类型的数据
  if (cmdTypes.includes(result.cmd)) {
    App.messageGraphManger.recvMsgHookForGraph(result);
  }
  App.messageGraphManger.handleRecvReqMissingMsg(src, responseID, result);
}

App.fn.bindEvent_On_ImMsg = bindEvent_On_ImMsg;

/**
 * 收到成员状态改变消息的回调函数
 * @param {Object} msg 成员状态消息体
 */
function onCMDMemberStatus(result) {
  const msg = result.msg;
  utils.log('IM_MEMBER_STATUS', msg);

  const appUser = App.user;
  const dbGroup = dbTools._newGroup(App.db, msg.group.title, msg.group.key);
  const cmdPayload = JSON.parse(msg.message.info.text);
  const memberStatus = cmdPayload.body.memberStatus;

  // 如果存在接收人列表
  if (msg.receivers) {
    // 如果当前用户在接收人列表中，就判断是否为群主
    if (__inReceivers(appUser.publicKey, msg.receivers)) {
      const isGroupOwner = dbTools.isGroupOwner(
        App.db,
        dbGroup.id,
        appUser.publicKey
      );

      // 如果是群主就创建通知消息
      if (isGroupOwner) {
        for (let invitee of memberStatus) {
          baseNotice.createAddGroupMemberNotice({
            msgKey: msg.key,
            group: {
              title: dbGroup.title,
              key: dbGroup.key
            },
            inviter: msg.user,
            invitee: invitee
          });
          noticedom.setNoticeBadge('show');
        }
      }
    }
  } else {
    if (!baseGroup.checkIsGroupFromCache(msg.group)) {
      baseGroup.cacheGroup(dbGroup);

      if (memberStatus.length === 2) {
        dbGroup.title = memberStatus[0]['nickname'];
        dbTools.updateGroupTitle(App.db, dbGroup.id, dbGroup.title);
      }
    }

    renderGUIGroupListItem(dbGroup);
    renderGroupChat(dbGroup);

    let changed = false;
    let inMemberList = false;
    // 更新用户状态
    for (let m of memberStatus) {
      if (App.user.publicKey === m.publicKey) {
        inMemberList = true;
      }

      if (m.isInGroup) {
        dbTools.addGroupMember(App.db, dbGroup.id, m);

        let member = dbTools.getGroupMember(App.db, dbGroup.id, m.publicKey);

        if (member && member.online !== Number(m.isOnline)) {
          dbTools.updateGroupMemberIsOnline(
            App.db,
            dbGroup.id,
            m.publicKey,
            m.isOnline
          );
          changed = true;
        }
      } else {
        dbTools.removeGroupMember(App.db, dbGroup.id, m.publicKey);
        changed = true;
      }
    }

    const addrs = App.fn.initGroup(dbGroup);

    App.messageGraphManger.createGroupMsgGraph(dbGroup['key'], addrs);
    // initGroupMembers(dbGroup);

    if (changed) {
      App.messageGraphManger.groupMembersChange(dbGroup.key, addrs);
    }

    const lastMsg = cmdPayload.body.lastMsg;

    if (inMemberList && lastMsg) {
      App.messageGraphManger.recvMsgHookForGraph(lastMsg);
      bindEvent_On_ImMsg(lastMsg.msg.user.publicKey, lastMsg);
    }
    updateGUIGroupMemberNum(dbGroup.id);
    renderGUIGroupMemberList(dbGroup.id);
  }

  App.messageGraphManger.recvMsgHookForGraph(result);

  /**
   * 判断指定用户是否在接收人列表中
   * @param {String} publicKey 指定用户的公钥
   * @param {Array} receivers 消息接收人列表
   */
  function __inReceivers(publicKey, receivers) {
    for (let ru of receivers) {
      if (ru.publicKey === publicKey) {
        return true;
      }
    }

    return false;
  }
}

App.fn.onCMDMemberStatus = onCMDMemberStatus;

const _events = {
  /**
   * 群组列表项被点击事件
   */
  onMessageGroupItemClick() {
    $(document).on('click', '.message__group__item', function() {
      const $item = $(this);
      const groupId = $item.data('groupId');

      // 隐藏新消息提示
      $item.find('.badge-dot').addClass('hide');
      // 显示聊天界面
      showGroupChat(groupId);
    });
  },

  /**
   * 联系人被点击事件
   */
  onContactItemClick() {
    $(document).on('click', '.contact__item', function() {
      const $item = $(this);
      const itemId = $item.data('itemId');

      if ($item.hasClass('is-user')) {
        // 如果是用户就渲染用户信息面板
        renderContactPanel(itemId);
      } else {
        // 否则渲染聊天室信息面板
        renderChatroomInfoPanel(itemId);
      }
    });
  },

  /**
   * 联系人被双击事件
   */
  onContactItemDblClick() {
    $(document).on('dblclick', '.contact__item', function() {
      const $item = $(this);
      const itemId = $item.data('itemId');

      if ($item.hasClass('is-user')) {
        // 如果是用户就渲染用户聊天面板
        let user = dbTools.getUserById(App.db, itemId);
        App.activedUser = user;

        _onBtnSendMsgClick();
      } else {
        // 如果是聊天室就渲染聊天室面板（使用 chatroom-client 组件）
        const chatroom = dbCore.getChatroomById(App.db, itemId);
        const group = dbTools._newGroup(
          App.db,
          chatroom.title,
          chatroom.publicKey
        );
        App.activedGroup = group;

        onShowChatPanelBtnClick(group);
      }
    });
  },

  /**
   * 按钮“展示添加联系人弹出层”点击事件
   */
  onBtnShowAddContactModalClick() {
    $(document).on('click', '#btn--add-contact', function() {
      const $modal = $('#modal--add-user');
      const $text = $modal.find('.search-public-key');

      $text.val('');
      $modal.removeClass('v-hide');
      $text.focus();
    });
  },

  /**
   * 按钮“发送消息”点击事件
   */
  onBtnSendMessageClick() {
    $(document).on('click', '.btn--send-message', function() {
      _onBtnSendMsgClick();
    });
  },

  /**
   * 按钮“移除联系人”点击事件
   */
  onBtnRemoveContactClick() {
    $(document).on('click', '.btn--remove-contact', function() {
      const $btn = $(this);
      const $panel = $btn.closest('.contact__panel');
      const uid = parseInt($panel.data('itemId'));
      const $infoPanel = $btn.closest('.user-info__panel');
      const nickname = $infoPanel.find('.nickname').val();
      const publicKey = $panel.data('publicKey');

      if (
        window.confirm(`Remove Contact?
        [${nickname}]`)
      ) {
        dbCore.removeUser(App.db, uid);
        $('#tab__contact--contact')
          .find(`[data-target="#tab__contact_u${uid}"]`)
          .remove();
        $(`#tab__contact_u${uid}`).remove();
        baseContact.removeContactFromCache({
          id: uid,
          publicKey: publicKey
        });
      }
    });
  },

  /**
   * 按钮“展示成员列表”点击事件
   */
  onBtnShowMembersClick() {
    $(document).on('click', '.btn--show-members', function() {
      const group = App.activedGroup;
      const $panel = $('#tab__message__group' + group.id);
      const $memberPanel = $panel.find('.members');
      const $chatPanel = $panel.find('.uic__chat-panel');

      if ($memberPanel.hasClass('hide')) {
        renderGUIGroupMemberList(group.id);
        $memberPanel.removeClass('hide');
        $chatPanel.css('margin-right', '159px');
      } else {
        $memberPanel.addClass('hide');
        $chatPanel.css('margin-right', '0px');
      }
    });
  },

  /**
   * 按钮“展示添加成员弹出层”点击事件
   */
  onBtnShowAddMembersModalClick() {
    $(document).on('click', '.btn--add-members', function() {
      const $modal = $('#modal--add-members');

      let html = '';
      let users = dbTools.getContacts(App.db);

      for (let u of users) {
        html += `
          <div class="main__lf__item" data-user-id="${u.id}">
              <div class="info">
                  <input type="checkbox">
                  <span class="nickname">${u.nickname}</span><br />
                  <small>${utils.formatPublicKey(u.publicKey)}</small>
              </div>
          </div>
        `;
      }

      $modal
        .find('.modal__bd')
        .empty()
        .html(html);
      $modal.removeClass('v-hide');
    });
  },

  /**
   * 群组标题输入框回车键事件
   */
  onGroupTitleInputEnter() {
    $(document).on('keydown', '.edit-group-info-panel input', function(event) {
      const KEY_ENTER = 13;

      if (event.which === KEY_ENTER) {
        const group = App.activedGroup;
        const $title = $(this);
        const title = $.trim($title.val());

        // 如果未修改就直接返回
        if (group.title === title) {
          return;
        }

        // 输入校验
        if (title === '' || title.length > 20) {
          alert('title input error, 1 ~ 20 characters');
          return;
        }

        if (title !== group.title) {
          group.title = title;
          updateGroupTitle(group.key, title);
          broadcastGroupMessages(group.key, {
            cmd: 'IM_CHANGE_GROUP_TITLE',
            msg: {
              group: {
                title: group.title,
                key: group.key
              }
            }
          });
        }

        utils.showTopMsg('Group info updated!');
      }
    });
  },

  /**
   * 按钮“展示添加成员弹出层”点击事件
   */
  onBtnShowAddMembersModalClick() {
    $(document).on('click', '.btn--add-members', function() {
      new AddMembersModal({
        group: App.activedGroup
      }).render();
    });
  },

  /**
   * 按钮“展示移除成员弹出层”点击事件
   */
  onBtnShowRemoveMembersModalClick() {
    $(document).on('click', '.btn--remove-members', function() {
      new RemoveMembersModal({
        group: App.activedGroup
      }).render();
    });
  },

  // /**
  //  * 按钮“添加群组成员”点击事件
  //  */
  // onBtnAddMembersClick() {
  //   // 添加成员到群组
  //   $(document).on('click', '#btn--control-add-members', function() {
  //     const $btn = $(this);
  //     const $selects = $btn.closest('.modal-container').find('input:checked');

  //     if ($selects.length === 0) {
  //       alert('Please select at first');
  //       return;
  //     }

  //     const group = App.activedGroup;

  //     // 获取已勾选联系人列表
  //     const userIds = [];

  //     for (let item of $selects) {
  //       userIds.push(
  //         $(item)
  //           .closest('.main__lf__item')
  //           .data('userId')
  //       );
  //     }

  //     const users = App.db
  //       .prepare(`select * from users where id in (${userIds.join(', ')})`)
  //       .all();

  //     const memberStatus = [];
  //     const isGroupOwner = dbTools.isGroupOwner(
  //       App.db,
  //       group.id,
  //       App.user.publicKey
  //     );
  //     // 如果当前用户不是群组，表示当前处于邀请群组成员环节
  //     const isInviteMode = !isGroupOwner;
  //     // 如果当前用户是群主，就添加新群成员进入数据库
  //     for (let u of users) {
  //       if (isGroupOwner) {
  //         dbTools.addGroupMember(App.db, group.id, u);
  //       }

  //       memberStatus.push({
  //         nickname: u.nickname,
  //         publicKey: u.publicKey,
  //         isInGroup: true,
  //         isOnline: true
  //       });
  //     }

  //     // 添加了新成员，需要初始化用于分发消息的群组分组
  //     initGroup(group);

  //     if (isGroupOwner) {
  //       broadcastAllMemberStatus(group.id);
  //     } else {
  //       // 广播添加群员消息
  //       broadcastGroupMemberStatus(group, memberStatus, isInviteMode);
  //     }

  //     // 更新群组成员数量
  //     updateGUIGroupMemberNum(group.id);

  //     // 重新渲染群成员列表
  //     renderGUIGroupMemberList(group.id);

  //     // 关闭模态框
  //     $('#modal--add-members').addClass('v-hide');
  //   });
  // },

  /**
   * 侧边栏按钮点击事件
   */
  onSidebarBtnsClick() {
    $(document).on('click', '.app__sidebar__bd .user-info img', function() {
      $('.app__sidebar__bd')
        .find('[data-target="#tab__contacts"]')
        .trigger('click');
      showAppUserPanel();
    });
  },

  /**
   * 窗口 resize 事件
   */
  onAppWindowResize() {
    AppWin.on('resize', function() {
      resizeTextarea();
    });
  },

  /**
   * 群成员列表项点击事件
   * 弹出群成员信息
   */
  onGroupMemberItemClick() {
    $(document).on('click', '.message__group .members__item', function() {
      const $item = $(this);
      const $modal = $('#modal--user-card');
      const publicKey = $item.data('publicKey');
      let user = dbCore.getUserByPublicKey(App.db, publicKey);

      if (user) {
        $modal.addClass('is-contact');
        $modal.removeClass('is-member');
      } else {
        user = {
          nickname: $.trim($item.text()),
          publicKey: publicKey,
          avatar: App.defaultAvatar
        };
        $modal.removeClass('is-contact');
        $modal.addClass('is-member');
      }

      $modal.find('.nickname').text(user.nickname);
      $modal.find('.publickey').text(utils.formatPublicKey(user.publicKey));
      $modal.find('.avatar').attr('src', user.avatar);
      $modal.data('user', user).removeClass('v-hide');
    });
  },

  /**
   * 用户卡片中“添加联系人”按钮点击事件
   */
  onBtnUserCardAddContactClick() {
    $(document).on('click', '.user-card__btns .add', function() {
      const $modal = $('#modal--user-card');
      const user = $modal.data('user');

      utils.showTopMsg('Request Ok.');
      $modal.addClass('v-hide');
      // 发送消息给对方，通知添加为联系人
      App.actions.sendAddContactRequest(user.publicKey);
    });
  },

  /**
   * 用户卡片中“给群员发送消息”按钮点击事件
   */
  onBtnUserCardSendMessageClick() {
    $(document).on('click', '.user-card__btns .send', function() {
      const $modal = $('#modal--user-card');
      const user = $modal.data('user');

      // 设置当前被激活的用户为希望开始聊天的用户
      App.activedUser = user;
      _onBtnSendMsgClick();
      $modal.addClass('v-hide');
    });
  },

  /**
   * 群聊界面群组标题点击事件
   *
   * 展示群信息弹出层
   */
  // onGroupTitleClick() {
  //   $(document).on('click', '.message__group__hd .group-name', function() {
  //     const $modal = $('#modal--group-info');
  //     const group = App.activedGroup;
  //     const $btnEdit = $modal.find('.btn--group-edit');

  //     if ($btnEdit.hasClass('btn--group-done')) {
  //       $btnEdit.removeClass('btn--group-done').text('Edit');
  //       $modal.find('[name="title"]').prop('readonly', true);
  //     }
  //     $modal.find('[name="title"]').val(group.title);
  //     $modal.removeClass('v-hide');
  //   });
  // },

  /**
   * 群组信息编辑按钮点击事件
   */
  onBtnGroupModalEditClick() {
    $(document).on('click', '#modal--group-info .btn--group-edit', function() {
      const $btn = $(this);
      const $modal = $('#modal--group-info');
      const $title = $modal.find('[name="title"]');
      const group = App.activedGroup;

      if ($btn.hasClass('btn--group-done')) {
        // 确认修改群组信息
        const title = $.trim($title.val());

        // 输入校验
        if (title === '' || title.length > 20) {
          alert('title input error, 1 ~ 20 characters');
          return;
        }

        // 未修改，返回
        if (title !== group.title) {
          updateGroupTitle(group.key, title);
          broadcastGroupMessages(group.key, {
            cmd: 'IM_CHANGE_GROUP_TITLE',
            msg: {
              group: {
                title: group.title,
                key: group.key
              }
            }
          });
        }

        utils.showTopMsg('Group info updated!');

        // 更新 GUI
        $title.prop('readonly', true);
        $btn.removeClass('btn--group-done').text('Edit');
      } else {
        $title.prop('readonly', false).focus();
        $btn.addClass('btn--group-done').text('Done');
      }
    });
  },

  /**
   * 离开群组按钮点击事件
   */
  onBtnGroupModalLeaveGroupClick() {
    $(document).on('click', '.btn--leave-group', function() {
      const group = App.activedGroup;

      if (window.confirm(`Leave group: ${group.title}?`)) {
        App.db
          .prepare('delete from im_group_user_relations where group_id = ?')
          .run(group.id);
        App.db.prepare('delete from im_groups where key = ?').run(group.key);

        // 更新 GUI
        $('#btn--group' + group.id).remove();
        $('#tab__message__group' + group.id).remove();
        $('#modal--group-info').addClass('v-hide');

        const user = App.user;

        broadcastGroupMessages(group.key, {
          cmd: 'IM_MEMBER_STATUS',
          msg: {
            group: {
              title: group.title,
              key: group.key
            },
            memberStatus: [
              {
                nickname: user.nickname,
                publicKey: user.publicKey,
                isInGroup: false,
                isOnline: false
              }
            ]
          }
        });
      }
    });
  },

  /**
   * 按钮“展示编辑用户信息”点击事件
   */
  onBtnShowEditInfoModal() {
    $(document).on('click', '.btn--show-edit-info-modal', function() {
      const $modal = $('#modal--user-info');

      $modal.find('.avatar').attr('src', App.user.avatar);
      $modal.find('[name="nickname"]').val(App.user.nickname);
      $modal.removeClass('v-hide');
    });
  },

  onBtnShowExportDialog() {
    $(document).on('click', '.btn--show-export-dialog', function() {
      $('#app__folder-input').click();
    });
  },

  /**
   * 用户信息弹出层头像表单点击事件
   * 选择图片作为新头像
   */
  onUserInfoModalFormAvatarClick() {
    $(document).on(
      'click',
      '#modal--user-info .form-group--avatar',
      function() {
        $('#app__user-avatar-input').trigger('click');
      }
    );
  },

  /**
   * 头像上传输入框 change 事件
   */
  onAvatarFileInputChange() {
    $('#app__user-avatar-input').on('change', function() {
      const fileDom = this;
      // 未选择文件，直接返回
      if (!fileDom.files || fileDom.files.length === 0) {
        return;
      }

      const file = fileDom.files[0];

      // 头像大小允许 50K 以内
      if (file.size > 50000) {
        alert('The picture is too large, only allowed within 50KB.');
        return;
      }

      utils.log('onAvatarFileInputChange', fileDom, fileDom.files);
      const bitmap = fs.readFileSync(file.path);
      const imgBase64 = Buffer(bitmap).toString('base64');
      const $modal = $('#modal--user-info');

      $modal
        .find('img.avatar')
        .attr('src', 'data:image/png;base64,' + imgBase64);
    });
  },

  /**
   * 用户信息弹出层保存信息按钮点击事件
   */
  onBtnUserInfoModalSaveUserClick() {
    $(document).on('click', '#modal--user-info .btn--save-user', function() {
      const $modal = $('#modal--user-info');
      const nickname = $.trim($modal.find('[name="nickname"]').val());

      if (nickname === '' || nickname.length > 20) {
        alert('Nickname is not valid, 1 ~ 20 characters allowed.');
        return;
      }

      const avatar = $modal.find('img.avatar').attr('src');

      App.user.nickname = nickname;
      App.user.avatar = avatar;

      const user = dbCore.getUserByPublicKey(App.db, App.user.publicKey);

      // 更新数据库
      App.db
        .prepare(
          'update users set nickname = $nickname, avatar = $avatar where publicKey = $publicKey'
        )
        .run({
          nickname: nickname,
          avatar: avatar,
          publicKey: user.publicKey
        });

      App.db
        .prepare(
          'update im_group_user_relations set user_nickname = $nickname where user_publicKey = $publicKey'
        )
        .run({
          nickname: nickname,
          publicKey: user.publicKey
        });

      // 更新 GUI
      $('.app__sidebar')
        .find('.user-info img')
        .attr('src', avatar);
      $(`[data-target="#tab__contact_u${user.id}"]`)
        .find('.nickname')
        .text(nickname);
      $('#tab__contact_u' + user.id)
        .find('.nickname')
        .val(nickname);
      // App.actions.bakAuth();
      $modal.addClass('v-hide');
    });
  }
};

/**
 * 遍历 _events 对象，执行所有的事件函数
 */
function bindEvents() {
  for (let eventFunc of Object.values(_events)) {
    if ($.isFunction(eventFunc)) {
      eventFunc();
    }
  }

  // chatPanel.bindChatPanelGuiEvents();
}

/**
 * 重新计算聊天窗口编辑器的宽高
 */
function resizeTextarea() {
  const width =
    $('body').width() -
    $('.app__main__lf').width() -
    $('.app__sidebar').width();

  $('.message__group__textarea').width(width - 21);
}

/**
 * 更新群组标题
 * @param {*} groupKey
 * @param {*} title
 */
function updateGroupTitle(groupKey, title) {
  // 输入校验
  if (title === '' || title.length > 20) {
    alert('title input error, 1 ~ 20 characters');
    return;
  }

  const db = App.db;
  const group = db
    .prepare('select * from im_groups where key = ?')
    .get(groupKey);

  if (group) {
    db.prepare('update im_groups set title = ? where key = ?').run(
      title,
      groupKey
    );

    group.title = title;
    baseGroup.cacheGroup(group, true);

    // 更新 GUI
    $('#btn--group' + group.id)
      .find('.nickname')
      .text(title);
    $('#tab__message__group' + group.id)
      .find('.group-name')
      .text(title);
  }
}

/**
 * 广播群员状态
 * @param {*} groupId
 */
function broadcastAllMemberStatus(groupId) {
  const users = dbTools.getMembers(App.db, groupId);
  const group = dbTools.getGroupById(App.db, groupId);
  const memberStatus = [];

  for (let u of users) {
    memberStatus.push({
      nickname: u.user_nickname,
      publicKey: u.user_publicKey,
      avatar: u.user_avatar,
      isInGroup: true,
      isOnline: true
    });
  }

  broadcastGroupMemberStatus(group, memberStatus);
}

App.fn.broadcastAllMemberStatus = broadcastAllMemberStatus;

/**
 * 列表联系人点击事件
 * @param {*} itemDom 列表联系人  HTML dom 对象
 */
function onMemberClick(itemDom) {
  const publicKey = $.trim($(itemDom).data('publicKey'));
  const fromUser = App.user;

  // 点自己时不触发事件
  if (fromUser.publicKey === publicKey) {
    return;
  }

  const toUser = dbCore.getUserByPublicKey(App.db, publicKey);

  const members = [
    {
      nickname: fromUser['nickname'],
      publicKey: fromUser['publicKey']
    },
    {
      nickname: toUser['nickname'],
      publicKey: toUser['publicKey']
    }
  ];

  const group = dbTools.newGroup(
    App.db,
    `${fromUser['nickname']},${toUser['nickname']}`,
    members
  );
  App.activedGroup = group;
  initGroupMembers(group);
}

/**
 * 初始化用于分发消息的群组分组
 * @param {*} groupId
 */
function initGroup(group) {
  // 初始化群组分组，用于消息分发
  const appUser = App.user;
  const onlineMembers = dbTools.getOnlineMembersInGroup(App.db, group.id);
  const addrs = [];

  for (let m of onlineMembers) {
    if (m['user_publicKey'] === appUser['publicKey']) {
      continue;
    }

    addrs.push(`${App.identifiers.MAIN}.${m['user_publicKey']}`);
  }

  groupManger[group.key] = addrs;

  return addrs;
}

App.fn.initGroup = initGroup;

/**
 * 发送消息按钮点击事件
 */
function _onBtnSendMsgClick() {
  const fromUser = App.user;
  const toUser = App.activedUser;

  // 点自己时不触发事件
  if (fromUser.publicKey === toUser.publicKey) {
    return;
  }

  const members = [
    {
      nickname: fromUser['nickname'],
      publicKey: fromUser['publicKey']
    },
    {
      nickname: toUser['nickname'],
      publicKey: toUser['publicKey']
    }
  ];

  const hasGroup = dbTools.getGroupOnTwoMember(App.db, members);

  // 如果已经发起过聊天就直接跳转到聊天界面
  if (hasGroup) {
    __initiatingChat();
  } else {
    // 发送”发起聊天“请求
    baseContact.sendInitiatingChatRequest(toUser['publicKey'], () => {
      // 发起聊天成功回调函数
      __initiatingChat();
    });
  }

  /**
   * 发起聊天
   */
  function __initiatingChat() {
    const group = dbTools.newGroup(App.db, `${toUser['nickname']}`, members);
    App.activedGroup = group;
    baseGroup.cacheGroup(group);

    initGroupMembers(group);

    $('[data-target="#tab__message"]').trigger('click');
    renderGUIGroupListItem(group, true);
    broadcastAllMemberStatus(group.id);
    $(`[data-target="#tab__message__group${group.id}"]`).trigger('click');
  }
}

/**
 * 将收到的聊天内容渲染到界面
 * @param {*} group
 * @param {*} itemConfigList
 */
function renderTalks(group, itemList) {
  const chatroomPanel = App.groupIdMap[group.id].chatroomPanel;
  const chatPanel = chatroomPanel.chatPanel;

  chatroomPanel.addMessageItems(itemList);

  if (!chatPanel.isReadingMode()) {
    // 如果是主动发出的消息或者用户未处于阅读历史消息状态
    // 就将滚动条滚动到最底部
    chatPanel.scrollToBottom();
  } else {
    // 显示“新消息”提示
    chatPanel.editor.nodes.$editorTip.removeClass('uic-hide');
  }

  ipc.send('newMsgNotify');
}

/**
 * 初始化 IM 组件
 * @param {NKNClient} client
 */
function init() {
  bindEvents();

  $('.app__sidebar__bd')
    .find('.user-info')
    .find('img')
    .attr('src', App.user.avatar);

  renderGUIGroups();
  renderGUIContacts();
  renderGUIGroupChatPanel();
  showAppUserPanel();
}

/**
 * 渲染界面群组聊天面板
 */
function renderGUIGroupChatPanel() {
  let groups = dbTools.getGroups(App.db);

  for (let group of groups) {
    renderGroupChat(group);
  }
}

/**
 * 展示当前登录用户个人页面
 */
function showAppUserPanel() {
  let user = App.db
    .prepare('select * from users where publicKey = ?')
    .get(App.user.publicKey);
  $('.app__main__contacts')
    .find(`[data-target="#tab__contact_u${user.id}"]`)
    .trigger('click');

  let $panel = $('#tab__contact_u' + user.id);

  $panel.find('.btn--send-message').addClass('hide');
  $panel.find('.btn--remove-contact').addClass('hide');
  $panel.find('.btn--show-edit-info-modal').removeClass('hide');
  $panel.find('.btn--show-export-dialog').removeClass('hide');
}

/**
 * 在群组中发送消息
 * @param {NKNClient} client
 * @param {String} groupKey
 * @param {*} msg
 */
function sendMsg(group, data, onSuccess) {
  let msgStr = JSON.stringify(data);

  App.cm.sendMessage(
    groupManger[group['key']],
    msgStr,
    groupManger[group['key']].length == 1
      ? true
      : false /** 广播消息取消 ACK */,
    false,
    groupManger[group['key']].length == 1 ? 3 : 0 /** 广播消息取消 ACK */,
    commonUtils.calcRetryTime(msgStr),
    () => {
      /* 发送成功回调*/
      onSuccess && onSuccess();
    },
    () => {
      /* 发送失败回调 */
    }
  );
}

/**
 * 生成聊天内容的 HTML
 * @param {Object} message
 */
function getTalksHtml(messages) {
  let html = '';
  let appUser = App.user;

  for (let item of messages) {
    if (item.user.publicKey === appUser.publicKey) {
      html += `
        <div class="talk__item talk__item--right" data-public-key="${
          item.user.publicKey
        }">
            <div class="talk__item__bd">
                <div class="nickname">
                    ${item.user.nickname}
                </div>
                <div class="content">
                    ${item.message}
                </div>
            </div>
            <div class="avatar">
                <img src="${item.user.avatar}">
            </div>
        </div>
      `;
    } else {
      html += `
        <div class="talk__item" data-public-key="${item.user.publicKey}">
            <div class="avatar">
                <img src="${item.user.avatar}">
            </div>
            <div class="talk__item__bd">
                <div class="nickname">
                    ${item.user.nickname}
                </div>
                <div class="content">
                    ${item.message}
                </div>
            </div>
        </div>
      `;
    }
  }

  return html;
}

/**
 * 更新界面显示的群组成员数量
 * @param {Object} group
 */
function updateGUIGroupMemberNum(groupId) {
  const row = App.db
    .prepare(
      'select count(id) as members_count from im_group_user_relations where group_id = ?'
    )
    .get(groupId);

  utils.log('updateGUIGroupMemberNum', groupId, row, row['members_count']);

  App.db
    .prepare('update im_groups set member_num = $memberNum where id = $groupId')
    .run({
      memberNum: row['members_count'],
      groupId: groupId
    });

  const memberNum = row['members_count'];
  $('#btn--group' + groupId)
    .find('.group-member-num')
    .text(memberNum);
  $('#tab__message__group' + groupId)
    .find('.group-member-num')
    .text(memberNum);

  let group = dbTools.getGroupById(App.db, groupId);

  if (memberNum > 2) {
    // 获取早期成员，用于修改群标题
    const earlyMembers = dbTools.getMembers(App.db, groupId, 3);

    let newTitle = `${earlyMembers[1]['user_nickname']}、${
      earlyMembers[2]['user_nickname']
    }`;

    console.log("xsadf");

    // 如果群组标题已经被修改过，就不再使用群成员昵称更新标题
    if (memberNum <= 3) {
      if (group.title.indexOf(earlyMembers[1]['user_nickname']) < 0) {
        return;
      }
    } else {
      if (group.title.indexOf(newTitle) < 0) {
        return;
      }
    }

    if (memberNum > 3) {
      newTitle += '...';
    }

    updateGroupTitle(group.key, newTitle);
    dbTools.updateGroupType(App.db, groupId);
  }
}
App.fn.updateGUIGroupMemberNum = updateGUIGroupMemberNum;

/**
 * 渲染联系人列表
 */
function renderGUIContacts() {
  let html = '';
  let users = dbTools.getContacts(App.db);
  utils.log('renderGUIContacts', users);

  for (let u of users) {
    baseContact.cacheContact(u, true);

    // 如果加入联系人请求未通过就跳过渲染
    if (u.status !== 'allow') {
      continue;
    }
    // 缓存用户信息

    html += `
        <div
          class="contact__item outline main__lf__item tab__nav__item is-user"
          data-target="#tab__contact_u${u.id}"
          data-item-id="${u.id}"
          data-public-key="${u.publicKey}"
          >
            <img src="${u.avatar}" class="avatar">
            <div class="info uic-text-ellipsis">
                <span class="nickname">${u.nickname}</span><br />
                <small><span class="status"></span>${utils.formatPublicKey(
                  u.publicKey
                )}</small>
            </div>
        </div>
    `;
  }

  $('#tab__contact--contact')
    .empty()
    .html(html);

  // 刷新联系人状态（在线、离线）
  App.actions.refreshContactsStatus(users);
}

/**
 *  渲染群组聊天窗口 HTML
 * @param {*} group
 */
function renderGroupChat(group) {
  let $groupTab = $('#tab__message__group' + group.id);

  if ($groupTab.length > 0) {
    return;
  }

  let $panel = $('.app__main__message').find('.app__main__rt');
  let html = `
    <div
      id="tab__message__group${group.id}"
      data-group-id="${group.id}"
      class="tab__content__pane message__group message__group--group"
      >
      <div class="message__group__hd">
        <span class="group-info">
          <b>(<span class="group-member-num">${group.member_num}</span>)</b>
          <span class="group-name">${group.title}</span>
        </span>
        <a href="javascript:;" style="display:none;" class="toolbar-button" data-control="data-list">
          <i class="iconfont icon-uic-folder"></i>
        </a>
        <a href="javascript:;" class="btn--show-members">
          <i class="iconfont icon-team"></i>
        </a>
      </div>

      <div class="members hide">
        <div class="group-info-panel">
          <div class="edit-group-info-panel hide">
            <div class="">
              <span class="">title:</span>
              <input type="text" class="" name="title" autocomplete="off">
            </div>
          </div>
          <div class="members__hd">
            <a href="javascript:;" class="btn--add-members">
              <i class="iconfont icon-plus-square"></i>
              <span>Add Members</span>
            </a>

            <a href="javascript:;" class="btn--remove-members hide">
              <i class="iconfont icon-minus-square"></i>
              <span>Remove Members</span>
            </a>
          </div>
          <div class="members__bd">
          </div>
        </div>
        <div class="leave-group-panel">
          <a href="javascript:;" class="btn btn--link btn--leave-group">Leave Group</a>
        </div>
      </div>
    </div>
  `;

  // 创建自定义导航组件
  const nav = new Nav();
  const $wrapper = $(html);

  // 如果是群主就显示移除群成员按钮
  if (dbTools.isGroupOwner(App.db, group.id, App.user.publicKey)) {
    $wrapper.find('.btn--remove-members').removeClass('hide');
  }

  // 创建聊天室面板
  const chatroomPanel = createChatroomPanel();
  // 在群组 ID 字典中记录聊天室面板实例
  App.groupIdMap[group.id] = {
    isFirstShow: true,
    chatroomPanel: chatroomPanel
  };
  // 缓存导航栏实例
  chatroomPanel.nav = nav;
  chatroomPanel.group = group;
  // 渲染导航
  nav.render($wrapper);
  // 向导航组件中添加聊天室面板
  nav.push('chatroom-panel', chatroomPanel).navTo('chatroom-panel');
  // 将位于外部的标题栏移入动态生成的页面内
  $wrapper.find('.message__group__hd').prependTo($wrapper.find('.uic-page'));
  // 绑定标题栏按钮点击事件
  __bindEvent_navToDataPanel();
  // 添加到页面
  $panel.append($wrapper);

  // 加载一次缓存消息
  setTimeout(() => {
    __loadCacheMsgsOnce(chatroomPanel.chatPanel);
  }, 300);

  /**
   * 加载一次历史消息
   * @param {ChatPanel} chatPanel
   */
  function __loadCacheMsgsOnce(chatPanel) {
    const messagePanel = chatPanel.messagePanel;

    messagePanel.$elem.trigger('mousewheel');

    setTimeout(() => {
      chatPanel.scrollToBottom();
    }, 500);
  }

  /**
   * 绑定事件，导航至数据列表面板
   */
  function __bindEvent_navToDataPanel() {
    $wrapper.find('[data-control="data-list"]').on('click', function() {
      let dataListPage = nav.getPage('data-list-page');

      // 如果是第一次打开就先创建文件列表页面
      if (!dataListPage) {
        dataListPage = new DataPanelPage({ title: 'Data List' });
        utils.log('__bindEvent_navToDataPanel', dataListPage);
        __bindEvent_getDataList(dataListPage);
        __bindEvent_onDataItemClick(dataListPage);
        nav.push('data-list-page', dataListPage);
      }

      dataListPage.getActivedDataList().reloadIfHasLastID();

      nav.navTo('data-list-page');
    });
  }

  /**
   * 绑定事件，获取数据列表
   */
  function __bindEvent_getDataList(dataListPage) {
    dataListPage.$on(dataListPage.EVENT_GET_FILE_LIST, opts => {
      const payload = JSON.parse(opts.data);
      const data = __getDataList(payload);
      utils.log('EVENT_GET_FILE_LIST', opts, JSON.parse(opts.data), data);

      opts.onResponse(
        `${App.identifiers.MAIN}.${App.user.publicKey}`,
        JSON.stringify(data)
      );
    });
  }

  /**
   * 绑定事件，列表项被点击事件
   */
  function __bindEvent_onDataItemClick(dataListPage) {
    // UI 渲染完毕后再为其绑定事件
    dataListPage.$on('rendered', () => {
      const imgListPanel = dataListPage.listMap['image'];

      // 为列表项绑定点击事件
      dataListPage.on(EVENT_CLICK_ITEM, (_, event, msg) => {
        const item = msg.item;
        const $elem = item.$elem;
        const itemConfig = item.config;
        const info = itemConfig.info;
        const dataURL = dbCore.getMessageDataByID(App.db, info.dataID);

        if (!hasDownloadTask(info.md5sum)) {
          const task = createDownloadTask({
            cm: App.cm,
            serverAddr: null, // 从本地数据库获取，无需接入网络
            md5: info.md5sum,
            dataID: info.dataID,
            payloadLength: info.len,
            dataURL: dataURL
          });

          // 绑定下载完成回调事件
          task.on(task.EVENT_DONE, dataURL => {
            utils.log('EVENT_DONE', dataURL.length);
            item.setStatus('done');
            itemConfig.isLazyMode = false;
            itemConfig.info['dataUrl'] = dataURL;
            itemConfig.imgInfo && (itemConfig.imgInfo.imgSrc = dataURL);

            switch (item.config.type) {
              case 'image': {
                // 生成 blob URL
                const blob = dataURItoBlob(dataURL);
                const blobURL = createBlobUrl(blob);

                $elem
                  .find('.item-preview')
                  .empty()
                  .html(`<img src="${blobURL}" />`);

                break;
              }

              case 'article': {
                $elem
                  .find('.icon-uic-cloud-dl')
                  .removeClass('icon-uic-cloud-dl')
                  .addClass('icon-uic-article');

                break;
              }

              case 'file': {
                // 生成 blob URL
                const blob = dataURItoBlob(dataURL);
                const blobURL = createBlobUrl(blob);

                $elem
                  .attr('href', blobURL)
                  .find('.icon-uic-cloud-dl')
                  .removeClass('icon-uic-cloud-dl')
                  .addClass('icon-uic-file');

                $elem.find('.icon-uic-right').removeClass('uic-hide');

                break;
              }

              default:
                break;
            }
          });

          // 绑定下载失败回调事件
          task.on(task.EVENT_FAIL, (sliceNum, error) => {
            utils.log('EVENT_FAIL', sliceNum, error);
            item.setStatus('fail');
          });

          // 初始化进度
          item.setStatus('load', '0%');
          task.start();
        }

        switch (item.config.type) {
          case 'image': {
            if (!window.isImageModalVisible) {
              const imagePreviewModal = new ImagePreviewModal({
                imgInfoList: imgListPanel.imgInfoList,
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
                  imgInfo.item.$elem.trigger('click');

                  utils.log('image preview item created');

                  // 通过 md5 读取下载任务
                  const task = createDownloadTask({
                    cm: App.cm,
                    serverAddr: null,
                    md5: imgInfo.md5sum,
                    dataID: imgInfo.dataID,
                    payloadLength: imgInfo.len
                  });

                  utils.log('image preview item task', task);

                  // 绑定下载进度回调事件，更新图片预览“下载进度条”
                  task.on(task.EVENT_PROGRESS, __onProgress);
                  // 绑定下载完成事件，更新预览图为完整图片
                  task.on(task.EVENT_DONE, __onDone);
                  // release 事件被触发时解绑下载任务回调
                  previewItem.$on('release', () => {
                    task.off(task.EVENT_PROGRESS, __onProgress);
                    task.off(task.EVENT_DONE, __onDone);
                  });

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
            break;
          }
          case 'article': {
            const pageName = `read_article_${getUniqueNum()}`;
            nav
              .push(pageName, new ArticlePage({ info: itemConfig.info }))
              .navTo(pageName);
            break;
          }
        }
      });
    });
  }

  /**
   * 获取数据列表
   * @param {Object} payload
   */
  function __getDataList(payload) {
    utils.log('__getDataList', payload);

    let options = {
      type: payload.msg.type,
      ext: payload.msg.ext ? payload.msg.ext : '',
      sort: payload.msg.sort ? payload.msg.sort : 'asc',
      search: payload.msg.search ? payload.msg.search : '',
      offset: payload.msg.offset ? payload.msg.offset : 0,
      count: payload.msg.count ? payload.msg.count : 2,
      msgDBName: 'im_messages',
      dataDBName: 'im_message_data',
      orderBy: 'create_time'
    };

    let type = payload.type ? payload.type : 'list';
    let data = messageCache.getSpecFilesList(App.db, type, options);

    return data;
  }
}

/**
 * 展示 GUI 聊天窗口
 * @param {*} groupId
 */
function showGroupChat(groupId) {
  let $panel = $('.app__main__message').find('.app__main__rt');
  let group = dbTools.getGroupById(App.db, groupId);

  App.activedGroup = group;

  // 渲染并展示聊天窗口
  renderGroupChat(group);
  $panel.children('.show').removeClass('show');
  const $groupPanel = $('#tab__message__group' + groupId);

  $groupPanel.addClass('show');

  // 编辑器获取焦点
  $panel
    .find('.show')
    .find('textarea')
    .trigger('focus');

  const groupConf = App.groupIdMap[group.id];

  // 如果是第一次展示群组聊天窗口，就将滚动条滚动到最底部
  if (groupConf.isFirstShow) {
    groupConf.isFirstShow = false;
    setTimeout(() => {
      groupConf.chatroomPanel.chatPanel.scrollToBottom();
    }, 0);
  }
}

/**
 * 渲染联系人个人面板
 * @param {*} userId
 */
function renderContactPanel(userId) {
  let $contactTab = $('#tab__contact_u' + userId);
  let $panel = $('.app__main__contacts').find('.app__main__rt');
  let user = dbTools.getUserById(App.db, userId);

  App.activedUser = user;

  App.page['user' + user.id] = {
    offset: 0,
    limit: App.pageLimit
  };

  if (!App.caches['user' + user.id]) {
    App.caches['user' + user.id] = {};
  }

  if ($contactTab.length === 0) {
    let html = `
      <div
        id="tab__contact_u${user.id}"
        data-item-id="${user.id}"
        data-public-key="${user.publicKey}"
        class="tab__content__pane contact__panel is-user show"
        >
          <nav class="tab__theme--main">
              <div class="tab__navs">
                  <a href="javascript:;" data-target="#tab${
                    user.id
                  }__user-info" class="tab__nav__item active" data-toggle="tab">info</a>
                  <a href="javascript:;" data-target="#tab${
                    user.id
                  }__search" class="tab__nav__item" data-toggle="tab">files</a>
              </div>
          </nav>
          <div id="tab${user.id}__search" class="tab__content__pane">
              <div class="app__files">
                  <div class="form-group hide">
                      <span class="form-group__addon">Address:</span>
                      <input
                        type="text"
                        class="form-group__item"
                        name="search-publicKey"
                        value="${user.publicKey}">
                  </div>
                  <div class="form-group">
                      <span class="form-group__addon">KeyWord:</span>
                      <input type="text" class="form-group__item" name="search-keyword">
                      <span class="form-group__addon">
                          <a href="javascript:;" class="btn btn--link btn--control-search">Search</a>
                      </span>
              </div>
                  <div class="app__files__wrapper">
                      <table class="">
                          <thead>
                              <tr class="">
                                  <th>user</th>
                                  <th>filename</th>
                                  <th>size(KB)</th>
                              </tr>
                          </thead>
                          <tbody class="">
                          </tbody>
                      </table>
                      <div class="loadmore-panel loadmore--search">
                          <span class="loadmore__item no-more">
                              <small>no more</small>
                          </span>
                          <span class="loadmore__item loading">
                              <small>loading...</small>
                          </span>
                          <a href="javascript:;" class="loadmore__item btn--link btn--loadmore loadmore">loadmore</a>
                      </div>
                  </div>
              </div>
          </div>
          <div id="tab${
            user.id
          }__user-info" class="tab__content__pane user-info__panel show">
              <div class="form-group no-border">
                  <span class="form-group__addon">Nickname:</span>
                  <input type="text" class="form-group__item nickname" value="${
                    user.nickname
                  }" readonly>
              </div>
              <div class="form-group no-border">
                  <span class="form-group__addon">Address:</span>
                  <input type="text" class="form-group__item copy-input" value="${
                    user.publicKey
                  }" readonly>
                  <span class="form-group__addon">
                      <a href="javascript:;" class="btn btn--link btn--control-copy">copy</a>
                  </span>
              </div>
              <div style="text-align: center; padding-top: 30px;">
                  <a href="javascript:;" class="btn btn--primary btn--send-message" style="margin-right: 20px;">Send Message</a>
                  <a href="javascript:;" class="btn btn--danger btn--remove-contact" style="margin-right: 20px;">Remove Contact</a>
                  <a href="javascript:;" class="btn btn--primary btn--show-edit-info-modal hide" style="margin-right: 20px;">Edit User Info</a>
                  <a href="javascript:;" class="btn btn--primary btn--show-export-dialog hide" style="margin-right: 20px;">Export User Files</a>
              </div>

          </div>
      </div>
    `;

    $panel.children('.show').removeClass('show');
    $panel.append(html);
  }
}

exports.init = init;
exports.renderGUIContacts = renderGUIContacts;
exports.bindEvent_On_ImMsg = bindEvent_On_ImMsg;
