//https://github.com/dagrejs/graphlib/wiki/API-Reference
var Graph = require('graphlib').Graph;
const { formatPublicKey } = require('common.utils');
const App = require('./store');
const dbCore = require('./db');
const { dbTools } = require('./im-actions');
const utils = require('./utils');
//https://github.com/electron-userland/electron-json-storage
const storage = require('electron-json-storage');

/**
 * 程序所有群组消息的 Graph 管理
 */
function messageGraph() {
  /** 所有群组的 Graph 管理 */
  this.graphs = {};
  /**
   * 等待请求的消息队列
   *  { { groupID1: [ {msgKey1, active}, {msgKey2, active} ] }, { groupID2: [ msgKey1, active ] } }
   */
  this.waitReqQueue = {};
  /**
   * 群组中成员记录
   *  { { groupID1: [ member1, member2 ] }, { groupID2: [ member1 ] } }
   */
  this.groupMembers = {};

  /**
   * 消息快照，用于 UI 恢复历史消息记录
   * 数组中的消息顺序为 从 最旧 到 最新，即 Array[0] 是最旧的数据
   *  { { groupID1: [ msgKey1, msgKey2 ] }, { groupID2: [ msgKey1 ] } }
   */
  this.msgSnapshot = {};
  utils.log('msgSnapshot Storage', storage.getDataPath());

  this.initGroupMsgGraph();
}

const messageGraphProto = messageGraph.prototype;

/**
 * 读取上次开启 APP 时的消息快照
 * @param {String} groupKey 群编号
 */
messageGraphProto.initGroupMsgSnapshot = function(groupKey) {
  let _this = this;
  /** 读取以保存的消息快照文件 */
  storage.get(groupKey, function(error, data) {
    if (error) {
      utils.log('Error! initGroupMsgSnapshot', groupKey);
      _this.msgSnapshot[groupKey] = [];
    } else {
      /** 防止 storage 组件默认将变量初始为 object */
      if (Object.prototype.toString.call(data) === '[object Array]') {
        _this.msgSnapshot[groupKey] = data;
      } else {
        _this.msgSnapshot[groupKey] = [];
      }
    }
  });
};

/**
 * 用于初始化群组的消息 Graph，在打开程序时使用
 */
messageGraphProto.initGroupMsgGraph = function() {
  let sql = 'SELECT id, key FROM im_groups';
  let result = App.db.prepare(sql).all();
  if (result) {
    for (let groupData of result) {
      let graph = new Graph();
      /** 查询所有上次记录的边缘节点，用于当前 Graph 的 Parent */
      sql = `SELECT sinks FROM im_message_graph_sinks WHERE group_key = ?`;
      result = App.db.prepare(sql).get([groupData.key]);

      if (result && result['sinks']) {
        /** 是已存在的群聊，需要获取上一次的末位节点，添加到 Graph 作为 Top */
        let sinks = result['sinks'].split(',');
        utils.log('INIT_MSGGRAPH', groupData.key, sinks);
        for (let msgKey of sinks) {
          graph.setNode(msgKey);
        }
      }
      /** 初始化数据 */
      this.graphs[groupData.key] = graph;
      this.waitReqQueue[groupData.key] = [];
      this.groupMembers[groupData.key] = [];

      /** 初始化上次开启 APP 时的消息快照 */
      this.initGroupMsgSnapshot(groupData.key);

      /** 读取数据库中群组成员列表 */
      sql = `SELECT user_publicKey FROM im_group_user_relations WHERE group_id = ?`;
      result = App.db.prepare(sql).all([groupData.id]);
      for (let userPublicKey of result) {
        this.groupMembers[groupData.key].push(userPublicKey);
      }
    }
  }
};

/**
 * [API] 用于插入消息到消息快照中
 * @param {String} groupKey 群编号
 * @param {String} msgKey 消息编号
 * @param {String} insFrom 待插入的消息编号的前一个消息的编号, 即 msgKey 是 insFrom 的 Parent
 */
messageGraphProto.insertToMsgSnapshot = function(
  groupKey,
  msgKey,
  insFrom = null
) {
  if (this.msgSnapshot[groupKey].indexOf(msgKey) >= 0) {
    /** 该消息已经存在于快照存储中 */
    return;
  }

  if (insFrom) {
    /** 规定位置的插入 */
    let fromIdx = this.msgSnapshot[groupKey].indexOf(insFrom) - 1;
    let insertIdx = fromIdx >= 0 ? fromIdx : 0;
    this.msgSnapshot[groupKey].splice(insertIdx, 0, msgKey);
  } else {
    /** 插入最新的消息 */
    this.msgSnapshot[groupKey].push(msgKey);
  }
  /** 保存到消息快照文件中 */
  storage.set(groupKey, this.msgSnapshot[groupKey], function(error) {
    if (error) {
      utils.log(
        'Error! insertToMsgSnapshot',
        'Storage Set Error',
        groupKey,
        this.msgSnapshot[groupKey]
      );
    }
  });
};

/**
 * 用于创建群组的消息 Graph，在新建或加入群组中使用
 * @param {String} groupKey 群编号
 * @param {Array} members 群成员公钥列表
 */
messageGraphProto.createGroupMsgGraph = function(groupKey, members) {
  /** 创建 Graph 数据结构，并记录在数组中*/
  if (this.groupMembers[groupKey]) {
    return;
  } else {
    /** 初始化所有必要的数据 */
    let graph = new Graph();
    this.graphs[groupKey] = graph;
    this.waitReqQueue[groupKey] = [];
    this.groupMembers[groupKey] = [];
    this.msgSnapshot[groupKey] = [];
    for (let userPublicKey of members) {
      this.groupMembers[groupKey].push(userPublicKey);
    }
  }
};

/**
 * 修改成员列表
 * @param {String} groupKey 群编号
 * @param {Array} members 群成员公钥列表
 */
messageGraphProto.groupMembersChange = function(groupKey, members) {
  if (this.groupMembers[groupKey]) {
    /** 该群组是存在的，直接修改成员信息 */
    this.groupMembers[groupKey] = members;
  } else {
    /** 该群组不存在（群组由他人创建得来） */
    this.createGroupMsgGraph(groupKey, members);
  }
};

/**
 * 添加丢失消息到待请求的队列中
 * @param {String} groupKey 群编号
 * @param {Object} missMsgKey 丢失的消息标识符
 * @param {Object} associatedKey 丢失的消息的子节点消息标识符
 */
messageGraphProto.missMsgKeIntoQueue = function(
  groupKey,
  missMsgKey,
  associatedKey
) {
  let _this = this;
  if (missMsgKey.length > 0) {
    /** 检查需要获取的缺失是否已经在队列中 */
    for (let waitNode of this.waitReqQueue[groupKey]) {
      if (waitNode.msgKey == missMsgKey) {
        /** 已存在无需重复添加 */
        return;
      }
    }

    /** 增添消息请求到队列中 */
    this.waitReqQueue[groupKey].push({
      msgKey: missMsgKey,
      active: () => {
        let graph = _this.graphs[groupKey];
        graph.setEdge(missMsgKey, associatedKey);
      }
    });
  }
};

/**
 * 用于构建发送信息的 Graph Parents
 * @param {String} groupKey 群编号
 * @param {Object} msgJson 发送的消息内容
 */
messageGraphProto.sendMsgHookForGraph = function(groupKey, msgJson) {
  let graph = this.graphs[groupKey];
  let msgKey = msgJson.msg.key;

  /** 填充到消息快照中 */
  this.insertToMsgSnapshot(groupKey, msgKey);

  if (graph) {
    /** 获取当前 Graph 的所有末位节点，作为发送消息的 Parents */
    let parents = graph.sinks();
    msgJson.msg.parents = parents;
    if (parents.length > 0) {
      /** 获取所有 Parent 节点，渲染 Graph 结构 */
      for (let parent of parents) {
        graph.setEdge(parent, msgKey);
      }
    } else {
      /** 作为第一个节点使用 */
      graph.setNode(msgKey);
    }

    /** 记录边缘节点到数据库 */
    this.recordGroupSinks(groupKey, graph.sinks());
  } else {
    utils.log('Error!, TX Graph: ', this.graphs, ', Input: ', groupKey);
  }
};

/**
 * 用于保存记录接收信息的 Graph Parents
 * @param {Object} msgJson 接收的消息内容
 * @param {Boolean} isBroadcast 是否为处理广播消息的内容
 */
messageGraphProto.recvMsgHookForGraph = function(msgJson, isBroadcast = false) {
  let msgKey = msgJson.msg.key;
  let groupKey = msgJson.msg.group.key;
  let graph = this.graphs[groupKey];

  /** 填充到消息快照中 */
  this.insertToMsgSnapshot(groupKey, msgKey);

  if (isBroadcast) {
    /** 广播消息携带的对方最新消息的处理 */
    let res = dbCore.checkMessageIsCached(App.db, msgKey);
    if (!res.exist) {
      /** 若数据库中没有该消息需要先存储 */
      dbCore.cacheMessage(App.db, groupKey, msgJson);
    }
  }

  if (graph) {
    let parents = msgJson.msg.parents;
    if (parents.length != 0) {
      /** 收到的消息存在 parents，则保存在自己的 Graph 中 */
      for (let parent of parents) {
        if (!graph.hasNode(parent)) {
          /** 若接收到的消息 Parent 不在当前内存的 Graph 中 */
          /** 则检查 Parent 是否在数据库中 */
          let res = dbCore.checkMessageIsCached(App.db, parent);
          if (res.exist) {
            /** 存在数据库中，创建 Graph 关系 */
            graph.setEdge(parent, msgKey);
          } else {
            /** 不存在数据库中，则将 Parent 放入待请求的队列中 */
            this.missMsgKeIntoQueue(groupKey, parent, msgKey);
          }
        }
        /** 记录 Graph 关系 */
        graph.setEdge(parent, msgKey);
      }
    } else {
      /** 群组中的第一条消息 */
      graph.setNode(msgKey);
    }
    /** 记录边缘节点到数据库 */
    this.recordGroupSinks(groupKey, graph.sinks());
  } else {
    utils.log('Error!, RX Graph: ', this.graphs, ', Input: ', groupKey);
  }
};

/**
 * 保存群组的边缘节点到数据库
 * @param {String} groupKey 群组 key
 * @param {Array} sinks 边缘节点列表
 */
messageGraphProto.recordGroupSinks = function(groupKey, sinks) {
  /** 先查询表中是否已有记录 */
  let sql = 'SELECT * FROM im_message_graph_sinks WHERE group_key = ?';
  let result = App.db.prepare(sql).get([groupKey]);
  let SQLParam = [];
  if (result) {
    /** 表中已有记录则需要更新数据 */
    sql = 'UPDATE im_message_graph_sinks SET sinks = ? WHERE group_key = ?';
    SQLParam.push(sinks.join(','), groupKey);
  } else {
    /** 表中无记录，需要添加 */
    sql = 'INSERT INTO im_message_graph_sinks(group_key, sinks) VALUES (?, ?)';
    SQLParam.push(groupKey, sinks.join(','));
  }
  // console.log('recordGroupSinks', sql, SQLParam);
  App.db.prepare(sql).run(SQLParam);
};

/**
 * 记录所有的末位节点到数据库中，用于下次同步消息，使用在程序退出前
 */
messageGraphProto.recordAllSinks = function() {
  /** 先清空表中的历史记录 */
  let sql = 'DELETE FROM im_message_graph_sinks';
  App.db.prepare(sql).run();

  /** 记录当前所有边缘节点到数据库 */
  sql = `
    INSERT INTO
        im_message_graph_sinks(group_key, sinks)
    VALUES
        (?, ?)
  `;
  for (let groupKey of this.graphs.keys()) {
    let graph = this.graphs[groupKey];
    App.db.prepare.run([groupKey, graph.sinks().join(',')]);
  }
};

/**
 * 构建标准消息 JSON 结构
 * @param {Object} msgData 消息数据
 * @param {Object} customCMD 需要自定义消息的 cmd 值
 */
messageGraphProto.buildMsgJSON = function(msgData, customCMD = null) {
  let group = App.groupMap[msgData.group_key];
  /** 获取消息发送者信息 */
  let userData = dbTools.getGroupMember(App.db, group.id, msgData.sender);

  /** 需要用来自定义的消息cmd类型 将自定义字符 与 原有的 cmd 用 '|' 拼接 */
  /** 主要用于 获取缺失消息获取使用 */
  let msgCMD = msgData.cmd_type;
  if (customCMD != null) {
    msgCMD = customCMD + '|' + msgData.cmd_type;
  }

  /** 构建标准消息 JSON 结构 */
  let resMsg = {
    cmd: msgCMD,
    msg: {
      key: msgData.key,
      parents: msgData.parents.split(','),
      user: {
        nickname: userData
          ? userData.user_nickname
          : formatPublicKey(msgData.sender),
        publicKey: msgData.sender
      },
      group: {
        key: msgData.group_key
      },
      message: {
        type: msgData.type
      },
      timestamp: msgData.create_time,
      isCacheMsg: true // 缓存消息标志位
    }
  };
  /** 不同消息类型处理 */
  if (msgData.type != 'text') {
    /** 文字类型消息 */
    resMsg.msg.message.info = {
      dataID: msgData.data_id,
      name: msgData.file_name,
      ext: msgData.ext_name,
      thumbnail: msgData.payload,
      isLazyMode: true
    };
    if (msgData.size && msgData.length) {
      resMsg.msg.message.info['size'] = msgData.size;
      resMsg.msg.message.info['len'] = msgData.length;
    }
  } else {
    /** 非文字类型消息 */
    resMsg.msg.message.info = {
      text: msgData.payload
    };
  }

  return resMsg;
};

/**
 * 回复对方需要的缺失消息
 * @param {NKN Addr} fromUser 消息来源公钥
 * @param {Integer} msgID 收到的消息 ID,用于回复
 * @param {Object} reqMsg 接收的消息 JSON
 */
messageGraphProto.handleRecvReqMissingMsg = function(fromUser, msgID, reqMsg) {
  // console.log('handleRecvReqMissingMsg', fromUser, msgID, reqMsg);
  if (reqMsg.cmd != 'REQ_MISS_MESSAGE') {
    return;
  } else {
    /** 查询的需要请求的消息是否存在于自己的数据库中 */
    let msgKey = reqMsg.key;
    let res = dbCore.checkMessageIsCached(App.db, msgKey);
    utils.log('handleRecvReqMissingMsg', msgKey, res);
    if (res.exist) {
      /** 需要获取的数据存在，则构建消息结构返回给请求者 */
      let resMsg = this.buildMsgJSON(res.data, 'RES_MISS_MESSAGE');

      utils.log('SEND RES_MISS_MESSAGE', fromUser, resMsg);

      /** 发送处理好的消息 */
      App.cm.sendMessage(
        fromUser,
        JSON.stringify(resMsg),
        false,
        false,
        0,
        30000,
        () => {},
        () => {},
        null,
        msgID
      );
    }
  }
};

/**
 * 获取本地不存在的消息
 * @param {function} UIcallback UI渲染的回调函数
 */
messageGraphProto.getMissingMsgsDispatch = function(UIcallback = null) {
  const _this = this;

  const eachLoopIntervalMS = 500;

  /** 循环调度从缺失信息队列中执行获取消息任务 */
  __getMissMsgDispatchLoop();

  function __getMissMsgDispatchLoop() {
    /** 循环所有的群组 */
    // console.log('__dispatchLoop', _this.waitReqQueue);
    let missMessageQueue = {};
    for (let group of Object.keys(_this.waitReqQueue)) {
      /** 获取某个群组待请求的消息 Queue */
      if (_this.waitReqQueue[group].length > 0) {
        missMessageQueue[group] = [];
        let curGroupMembers = App.groupManger[group];
        if (curGroupMembers.length > 0) {
          /** 随机挑选一名成员获取消息 */
          let toUser =
            curGroupMembers[Math.floor(Math.random() * curGroupMembers.length)];

          utils.log('SEND REQ_MISS_MESSAGE', toUser, {
            cmd: 'REQ_MISS_MESSAGE',
            key: _this.waitReqQueue[group][0].msgKey
          });

          /** 获取数组的第一个消息 ID 的消息 */
          App.cm.sendMessage(
            toUser,
            JSON.stringify({
              cmd: 'REQ_MISS_MESSAGE',
              key: _this.waitReqQueue[group][0].msgKey
            }),
            true,
            true,
            0,
            30000,
            () => {},
            () => {},
            (src, responseMessage) => {
              /** onResponse 回调函数 */
              const responseJSON = JSON.parse(responseMessage);
              utils.log('RECV RES_MISS_MESSAGE', responseJSON);
              if (_this.waitReqQueue[group].length == 0) {
                /** 排除 NKN 网络缓存，使得报文重复导致的错误 */
                return;
              }

              if (responseJSON.msg.message.type) {
                /* 对方有需要的消息并回复 */
                /** 防止 Key 丢失 */
                if (!responseJSON.msg.key) {
                  responseJSON.msg.key = _this.waitReqQueue[group][0].msgKey;
                }
                /** 激活请求到的消息到 Graph 中 */
                _this.waitReqQueue[group][0].active();
                /** 在等待请求的队列中删除已请求成功的 key */
                _this.waitReqQueue[group].splice(0, 1);
                /** 复原原来的 CMD */
                let msgCMD = responseJSON.cmd.split('|')[1];
                responseJSON.cmd = msgCMD;
                /** 保存请求到的消息入库 */
                dbCore.cacheMessage(App.db, group, responseJSON);
                UIcallback && UIcallback(responseJSON);
                /** 判断该消息的 Prent 是否存在库中 */
                for (let parent of responseJSON.msg.parents) {
                  let res = dbCore.checkMessageIsCached(App.db, parent);
                  if (!res.exist) {
                    /** 若不存在则将 Prent 添加入待请求队列 */
                    _this.missMsgKeIntoQueue(
                      group,
                      parent,
                      responseJSON.msg.key
                    );
                  }
                }
                /** UI 需要处理的回调函数 */
                missMessageQueue[group].push(responseJSON);
              }
            }
          );
        }
      }
    }
    setTimeout(() => {
      __getMissMsgDispatchLoop();
    }, eachLoopIntervalMS);
  }

  /** 每3秒检查一次数据库中的消息完整度 */
  let checkOffset = 0;
  let checkCount = 30;
  setInterval(() => {
    __checkDataBaseMissMsgDispatchLoop();
  }, eachLoopIntervalMS * 10);

  function __checkDataBaseMissMsgDispatchLoop() {
    /** 分批查询消息的 Parents */
    let sql = `SELECT group_key, key, parents FROM im_messages ORDER BY id ASC LIMIT ?,?`;
    let result = App.db.prepare(sql).all([checkOffset, checkCount]);

    if (result.length > 0) {
      /** 查询到了内容，则进行检查操作 */
      for (let dbData of result) {
        /** 依次轮询查看每一条消息的 Parent 是否已经存在 */

        let parents = dbData['parents'].split(',');
        let groupKey = dbData['group_key'];
        let msgKey = dbData['key'];

        for (let parent of parents) {
          let res = dbCore.checkMessageIsCached(App.db, parent);
          if (!res.exist) {
            /** 若不存在则增添到获取队列中 */
            _this.missMsgKeIntoQueue(groupKey, parent, msgKey);
          }
        }
      }
      checkOffset += checkCount;
    }
  }
};

/**
 * [API] 返回历史消息用于 UI 渲染
 * @param {String} groupKey 群标识
 * @param {String} fromMsgKey 查询的位置定位消息标识（返回时不包含此消息）
 * @param {Integer} count 需要的消息数量
 */
messageGraphProto.getLastCachedMessages = function(
  groupKey,
  fromMsgKey = null,
  count = 10
) {
  let historyMsgs = [];
  let pushCount = count;
  let groupMsgKeys = this.msgSnapshot[groupKey];

  /** 首先判断是否存在历史消息 */
  if (groupMsgKeys && groupMsgKeys.length > 0) {
    let idxStart = -1;

    /** 是否需要从某个消息处进行偏移查询 */
    if (fromMsgKey) {
      idxStart = this.msgSnapshot[groupKey].indexOf(fromMsgKey) - 1;
    } else {
      idxStart = groupMsgKeys.length - 1;
    }

    if (idxStart >= 0) {
      for (let idx = idxStart; idx >= 0; idx--) {
        let _msgKey = this.msgSnapshot[groupKey][idx];
        /** 读取数据库中的消息内容 */
        let res = dbCore.checkMessageIsCached(App.db, _msgKey);
        if (res.exist) {
          /** 将消息数据渲染为标准消息 JSON 结构 */
          historyMsgs.push(this.buildMsgJSON(res.data));
        } else {
          utils.log('Error! getLastCachedMessages', 'MISS MSG', _msgKey);
        }
        /** 控制返回的消息数量 */
        pushCount -= 1;
        if (pushCount <= 0) {
          break;
        }
      }
    } else {
      utils.log(
        'Error! getLastCachedMessages',
        'idxStart < 0',
        idxStart,
        this.msgSnapshot[groupKey],
        fromMsgKey
      );
    }
  }
  return historyMsgs;
};

/**
 * 调试函数
 */
messageGraphProto.debug = function() {
  for (let group of Object.keys(this.graphs)) {
    console.log('group', group);
    console.log('nodes: ', this.graphs[group].nodes());
    console.log('edges: ', this.graphs[group].edges());
    console.log('WQ', this.waitReqQueue[group]);
  }
};

module.exports = exports = {
  messageGraph
};
