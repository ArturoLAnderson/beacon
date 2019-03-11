const uuidv1 = require('uuid/v1');
const nanotime = require('nano-time');

const utils = require('./utils');
const { calcRetryTime } = require('common.utils');
const dbCore = require('./db');
const baseGroup = require('./groups');
const dbTools = {
  /**
   * 根据传入的两个成员判断群组是否已经创建
   * 仅用于点击联系人时创建群组前的判断
   * @param {Database} db
   * @param {Array} members 两个群组成员
   */
  getGroupOnTwoMember(db, members) {
    if (!members || members.length !== 2) {
      return;
    }

    const sql = `
      select ig.* from im_group_user_relations as ir
      left join im_groups as ig on ig.id = ir.group_id
      where ig.member_num = 2
      and
      exists(
          select 1 from im_group_user_relations
          where
              group_id = ig.id
          and
              im_group_user_relations.user_publicKey = $m0PubKey)
      and
      exists(
          select 1 from im_group_user_relations
          where
              group_id = ig.id
          and
              im_group_user_relations.user_publicKey = $m1PubKey)
      limit 1
    `;

    const group = db.prepare(sql).get({
      m0PubKey: members[0].publicKey,
      m1PubKey: members[1].publicKey
    });
    utils.log('getGroupOnClickMember', group);

    return group;
  },

  /**
   * 新建群组
   * @param {*} db
   * @param {*} title
   * @param {*} key
   */
  _newGroup(db, title, key, type = 'normal') {
    let sql = `
      insert into im_groups
      (key, title, type)
      select $key, $title, $type
      where not exists(
          select 1 from im_groups where key = $key
      )
    `;

    // 创建群组
    db.prepare(sql).run({
      key: key,
      title: title,
      type: type
    });

    // 获取群组信息
    let group = db.prepare('select * from im_groups where key = ?').get(key);

    return group;
  },

  /**
   * 新建群组
   */
  newGroup(db, title, members) {
    utils.log('db newGroup', members);

    // 使用初始化群组的两个成员进行数据库查询
    // 如果已存在仅包含这两个成员的群组就返回这个群组
    let group = this.getGroupOnTwoMember(db, members);

    // 如果群组存在就返回这个群组
    // 否则新建群组
    if (group) {
      return group;
    }

    // 生成唯一的 group key
    const groupKey = uuidv1();

    group = this._newGroup(db, title, groupKey);

    // 添加群组成员到数据库
    for (let user of members) {
      var sql = `
        insert into im_group_user_relations
        (group_id, user_nickname, user_publicKey)
        values($groupId, $userNickname, $userPublicKey)
      `;
      db.prepare(sql).run({
        groupId: group['id'],
        userNickname: user['nickname'],
        userPublicKey: user['publicKey']
      });
    }

    // 更新群组成员数量
    const newMemberNum = group['member_num'] + members.length;
    db.prepare('update im_groups set member_num = ? where id = ?').run(
      newMemberNum,
      group['id']
    );

    group['member_num'] = newMemberNum;

    return group;
  },

  /**
   * 判断指定公钥的用户是否是群主
   * @param {Database} db
   * @param {Number} groupId 群组在数据库中的 ID
   * @param {String} userPublicKey 指定用户的公钥
   */
  isGroupOwner(db, groupId, userPublicKey) {
    const sql = `
      select
        user_publicKey == ? as is_group_owner
      from
        im_group_user_relations
      where
        group_id = ? order by id limit 1`;

    const result = db.prepare(sql).get([userPublicKey, groupId]);

    if (result) {
      return result['is_group_owner'];
    } else {
      return null;
    }
  },

  /**
   * 获取群主信息
   * @param {Database} db 数据库实例
   * @param {Number} groupId 群组 ID
   */
  getGroupOwner(db, groupId) {
    const sql = `
      select *
      from
        im_group_user_relations
      where group_id = ? order by id limit 1`;

    return db.prepare(sql).get(groupId);
  },

  /**
   * 更新群标题
   * @param {Database} db
   * @param {Number} groupId 群 id
   * @param {String} title 群标题
   */
  updateGroupTitle(db, groupId, title) {
    const sql = `
      update im_groups set title = ? where id = ?
     `;

    db.prepare(sql).run([title, groupId]);
  },

  /**
   * 更新群类型为群组
   * @param {Database} db
   * @param {Number} groupId 群 id
   */
  updateGroupType(db, groupId) {
    const sql = `
      update im_groups set type = 'group' where id = ?
     `;

    db.prepare(sql).run(groupId);
  },

  /**
   * 获取群组中在线成员公钥列表
   * @param {Database} db
   * @param {Int} groupId
   */
  getOnlineMembersInGroup(db, groupId) {
    const sql = `
      select
          user_publicKey
      from
          im_group_user_relations
      where
          group_id = ?
      and
          online = 1
    `;

    return db.prepare(sql).all(groupId);
  },

  /**
   * 获取成员列表
   * @param {Database} db
   * @param {Int} groupId 群组 ID
   * @param {Int} count 获取数量，默认获取全部
   */
  getMembers(db, groupId, count = 0) {
    let sql = `
      select * from im_group_user_relations
      where group_id = ? order by id`;

    if (count > 0) {
      sql += ` limit ${count}`;
    }

    return db.prepare(sql).all(groupId);
  },

  /**
   * 获取数据库中记录的群组（会话）列表
   * @param {Database} db
   */
  getGroups(db) {
    return db.prepare('select * from im_groups order by id desc').all();
  },

  /**
   * 使用 id 查找单个群组（会话）的信息
   * @param {*} db
   * @param {*} groupId
   */
  getGroupById(db, groupId) {
    return db.prepare('select * from im_groups where id = ?').get(groupId);
  },

  /**
   * 使用 id 查找单个联系人（user）的信息
   * @param {*} db
   * @param {*} userId
   */
  getUserById(db, userId) {
    return db.prepare('select * from users where id = ?').get(userId);
  },

  /**
   * 获取联系人
   * @param {*} db
   * @param {*} currentUserId
   */
  getContacts(db) {
    return db.prepare('select * from users order by id desc').all();
  },

  /**
   * 添加群组成员到数据库
   * @param {*} db
   * @param {*} groupId
   */
  addGroupMember(db, groupId, newMember) {
    utils.log('addGroupMember', groupId, newMember);
    let member = dbTools.getGroupMember(App.db, groupId, newMember.publicKey);

    if (!member) {
      db.prepare(
        'insert into im_group_user_relations (group_id, user_nickname, user_publicKey, online) values (?, ?, ?, 1)'
      ).run(groupId, newMember.nickname, newMember.publicKey);

      return true;
    }

    return false;
  },

  /**
   * 获取群成员信息
   * @param {*} db
   * @param {*} groupId
   * @param {*} userPublicKey
   */
  getGroupMember(db, groupId, userPublicKey) {
    const sql = `
      select * from
          im_group_user_relations
      where
          group_id = ? and user_publicKey = ?
    `;
    return db.prepare(sql).get(groupId, userPublicKey);
  },

  /**
   * 更新群成员在线状态
   * @param {*} db
   * @param {*} groupId
   * @param {*} isOnline
   */
  updateGroupMemberIsOnline(db, groupId, userPublicKey, isOnline) {
    const sql = `
      update
          im_group_user_relations
      set
          online = $isOnLine
      where
          user_publicKey = $publicKey and group_id = $groupId
    `;
    db.prepare().run({
      isOnline: Number(isOnline),
      publicKey: userPublicKey,
      groupId: groupId
    });
  },

  /**
   * 移除群组成员
   * @param {Database} db
   * @param {Number} groupId
   * @param {String} userPublicKey
   */
  removeGroupMember(db, groupId, userPublicKey) {
    db.prepare(
      'delete from im_group_user_relations where group_id = ? and user_publicKey = ?'
    ).run(groupId, userPublicKey);
  }
};

exports.dbTools = dbTools;
App.fn.dbTools = dbTools;

/**
 * 渲染会话列表
 * @param {*} groups
 */
function renderGUIGroups() {
  let groups = dbTools.getGroups(App.db);

  for (let group of groups) {
    baseGroup.cacheGroup(group, true);
    renderGUIGroupListItem(group, true);
  }
}

exports.renderGUIGroups = renderGUIGroups;

/**
 * 渲染群组列表项
 * @param {Object} group 群组对象
 * @param {Boolean} isPrepend 是否添加到前置
 * @param {Boolean} hasNewMsg 是否有新消息
 */
function renderGUIGroupListItem(group, isPrepend = false, hasNewMsg = false) {
  App.groupMap[group.key] = group;

  // 初始化群组成员列表
  initGroupMembers(group);

  const $groupMenu = $('.app__main__message')
    .find('.app__main__lf')
    .find('.groups__bd');

  let $item = $groupMenu.find(`[data-group-id="${group.id}"]`);

  if ($item.length === 0) {
    let memberNumHtml = '';

    memberNumHtml = `(<span class="group-member-num">${
      group.member_num
    }</span>)`;

    $item = $(`
      <div
        class="message__group__item main__lf__item tab__nav__item"
        data-target="#tab__message__group${group.id}"
        data-group-id="${group.id}"
        data-group-key="${group.key}"
        id="btn--group${group.id}"
        >
          <div class="info">
              ${memberNumHtml}
              <span class="nickname">${group.title}</span>
          </div>
          <span class="badge-dot hide"></span>
      </div>
    `);

    $groupMenu.append($item);
  }

  // 如果是当前被激活的群组，就不添加新消息提示
  if ($(`#tab__message__group${group.id}`).hasClass('show')) {
    hasNewMsg = false;
  }

  // 添加新消息提示
  if (hasNewMsg) {
    $item.find('.badge-dot').removeClass('hide');
  }

  // 移动到列表顶部
  if (isPrepend) {
    $groupMenu.prepend($item);
    $groupMenu.scrollTop(0);
  }
}

exports.renderGUIGroupListItem = renderGUIGroupListItem;

/**
 * 如果群组的 key 的长度为 66，即 NKN 公钥长度，则认为此群组为聊天室类型群组
 * @param {String} key
 */
function isChatroomGroup(type) {
  return type === 'chatroom';
}

exports.isChatroomGroup = isChatroomGroup;

/**
 * 在群组中发送消息
 * @param {String} groupKey
 * @param {Object} msg
 */
function sendMsg(group, data, onSuccess, onError) {
  let msgStr = JSON.stringify(data);

  App.cm.sendMessage(
    groupManger[group['key']],
    msgStr,
    true,
    false,
    3,
    calcRetryTime(msgStr),
    () => {
      /* 发送成功回调*/
      onSuccess && onSuccess();
    },
    () => {
      /* 发送失败回调 */
      onError && onError();
    }
  );
}

exports.sendMsg = sendMsg;

/**
 * 初始化群组成员列表
 * @param {Object} group
 */
function initGroupMembers(group) {
  // 初始化群组分组，用于消息分发
  const onlineMembers = dbTools.getOnlineMembersInGroup(App.db, group['id']);
  const addrs = [];

  for (let m of onlineMembers) {
    if (m['user_publicKey'] === App.user['publicKey']) {
      continue;
    }

    addrs.push(`${App.identifiers.MAIN}.${m['user_publicKey']}`);
  }

  utils.log('onlineMembers', addrs, onlineMembers);
  groupManger[group['key']] = addrs;
  App.messageGraphManger.createGroupMsgGraph(group['key'], addrs);
}

exports.initGroupMembers = initGroupMembers;
App.fn.initGroupMembers = initGroupMembers;

/**
 * 广播群信息
 * @param {*} groupKey
 */
function broadcastGroupMessages(groupKey, payload) {
  let msgStr = JSON.stringify(payload);
  App.cm.sendMessage(
    groupManger[groupKey],
    msgStr,
    groupManger[groupKey].length == 1 ? true : false /** 广播消息取消 ACK */,
    false,
    groupManger[groupKey].length == 1 ? 3 : 0 /** 广播消息取消 ACK */,
    calcRetryTime(msgStr),
    () => {
      /* 发送成功回调*/
    },
    () => {
      /* 发送失败回调 */
    }
  );
}

exports.broadcastGroupMessages = broadcastGroupMessages;

/**
 * 广播群员状态
 * @param {Object} group 群组对象
 * @param {Array} memberStatus 成员状态列表
 * @param {Boolean} isInviteMode 是否是邀请成员模式
 *
 * @example
 * broadcastGroupMemberStatus({title: 'xx', key: 'key'}, [{
 *   nickname: u.user_nickname,
 *   publicKey: u.user_publicKey,
 *   avatar: u.user_avatar,
 *   isInGroup: true,
 *   isOnline: true
 * }])
 */
function broadcastGroupMemberStatus(group, memberStatus, isInviteMode = false) {
  let sender = App.user;
  let microTimestamp, msgKey;
  microTimestamp = nanotime.micro();
  msgKey = sender.publicKey.slice(-10) + microTimestamp;

  let msgJSON = {
    cmd: 'COMMAND',
    msg: {
      key: msgKey,
      group: {
        title: group.title,
        key: group['key']
      },
      user: {
        nickname: sender.nickname,
        publicKey: sender.publicKey
      },
      message: {
        type: 'text',
        info: {
          text: JSON.stringify({
            cmd: 'IM_MEMBER_STATUS',
            body: {
              memberStatus: memberStatus,
              lastMsg: getMsgFromSnapshot(group['key'])
            }
          })
        }
      },
      timestamp: microTimestamp
    }
  };

  // 如果是添加成员模式，就将消息接收人设置为群主
  if (isInviteMode) {
    let groupOwner = dbTools.getGroupOwner(App.db, group.id);

    // 如果当前用户不是群主，就将消息广播出去，并指定接收人为群主
    if (groupOwner['user_publicKey'] !== App.user.publicKey) {
      msgJSON.msg.receivers = [
        {
          nickname: groupOwner['user_nickname'],
          publicKey: groupOwner['user_publicKey']
        }
      ];
    }
  }

  /** 将消息 Graph 的 Parent 插入到消息中 */
  App.messageGraphManger.sendMsgHookForGraph(group['key'], msgJSON);
  dbCore.cacheMessage(App.db, group['key'], msgJSON);

  let msgStr = JSON.stringify(msgJSON);
  App.cm.sendMessage(
    groupManger[group.key],
    msgStr,
    groupManger[group['key']].length == 1
      ? true
      : false /** 广播消息取消 ACK */,
    false,
    groupManger[group['key']].length == 1 ? 3 : 0 /** 广播消息取消 ACK */,
    calcRetryTime(msgStr),
    () => {
      /* 发送成功回调*/
    },
    () => {
      /* 发送失败回调 */
    }
  );
}

exports.broadcastGroupMemberStatus = broadcastGroupMemberStatus;
App.fn.broadcastGroupMemberStatus = broadcastGroupMemberStatus;

/**
 * 从快照中获取指定群的最后一条消息
 * @param {String} groupKey 群组的唯一标识 key
 */
function getMsgFromSnapshot(groupKey) {
  const snapshot = App.messageGraphManger.msgSnapshot[groupKey];

  if (snapshot.length > 0) {
    const res = dbCore.checkMessageIsCached(
      App.db,
      snapshot[snapshot.length - 1]
    );
    if (res.exist) {
      return App.messageGraphManger.buildMsgJSON(res.data);
    }
  }

  return null;
}

exports.getMsgFromSnapshot = getMsgFromSnapshot;

/**
 * 渲染群组成员列表列表
 * @param {*} groupId
 */
function renderGUIGroupMemberList(groupId) {
  let html = '';
  const $panel = $('#tab__message__group' + groupId);
  const $memberPanel = $panel.find('.members');
  const members = dbTools.getMembers(App.db, groupId);
  const group = dbTools.getGroupById(App.db, groupId);

  const isGroupOwner = dbTools.isGroupOwner(
    App.db,
    groupId,
    App.user.publicKey
  );

  // 如果是群主就显示群组标题编辑面板
  if (isGroupOwner) {
    $('.edit-group-info-panel').removeClass('hide');
    $('.edit-group-info-panel input').val(group.title);
  }

  for (let m of members) {
    html += `
      <div class="members__item uic-text-ellipsis" data-public-key="${
        m['user_publicKey']
      }">
          ${m['user_nickname']}<br />
          <small>${utils.formatPublicKey(m['user_publicKey'])}</small>
      </div>
    `;
  }

  // updateGUIGroupMemberNum(groupId, members.length);
  $memberPanel
    .find('.members__bd')
    .empty()
    .html(html);
}

exports.renderGUIGroupMemberList = renderGUIGroupMemberList;
App.fn.renderGUIGroupMemberList = renderGUIGroupMemberList;
