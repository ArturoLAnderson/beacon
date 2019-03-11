const Database = require('better-sqlite3');
const path = require('path');
const schemas = require('./schemas');
const utils = require('./utils');

/**
 * 初始化数据库
 * @param {String} dbPath  数据存储目录
 */
function initDB(dbPath) {
  try {
    let db = new Database(path.resolve(dbPath, 'db.sqlite3'));

    for (let schema of Object.values(schemas)) {
      db.exec(schema);
    }

    // fixDB(db);
    return db;
  } catch (error) {
    const errmsg = 'database error.';
    alert(errmsg);
    utils.log(errmsg, error);
  }
}

/**
 * 修复旧版本数据库中缺少的字段
 * @param {*} db
 */
function fixDB(db) {
  _fix('alter table users add column is_fans boolean default(0)');
  _fix(
    `alter table im_group_user_relations add column user_avatar text default(\'${
      App.defaultAvatar
    }\')`
  );

  function _fix(sql, params) {
    try {
      let stmt = db.prepare(sql);
      if (params) {
        stmt.run(params);
      } else {
        stmt.run();
      }
    } catch (error) {
      // 跳过
      utils.log('fixdb', error, sql, params);
    }
  }
}

/**
 * 判断指定公钥的用户是否已经存在
 * @param {Database} db
 * @param {String} publicKey
 */
function isUserExists(db, publicKey) {
  const sql = `
        select exists(select 1 from users where publicKey = ?) as is_exist
    `;

  return db.prepare(sql).get(publicKey)['is_exists'];
}

/**
 * 新增用户
 * @param {Database} db
 * @param {String} publicKey
 * @param {String} nickname
 */
function registerUser(
  db,
  publicKey,
  nickname,
  avatar = '',
  isFans = 0,
  status = 'waiting'
) {
  const sql = `
        insert into
            users (nickname, publicKey, avatar, online, is_fans, status)
        select
            $nickname, $publicKey, $avatar, 1, $isFans, $status
        where
            not exists(select 1 from users where publicKey = $publicKey)
    `;

  db.prepare(sql).run({
    publicKey: publicKey,
    nickname: nickname,
    avatar: avatar,
    isFans: isFans,
    status: status
  });
}

/**
 * 获取正在分享的文件列表
 * @param {Database} db
 * @param {*} publicKey
 */
function getSharingFiles(db, publicKey) {
  const sql = `
        select
            files.id as fid, files.hash, r.file_name, r.file_size, users.publicKey, users.nickname, users.id as uid
        from
            user_file_relations as r
        left join
            files on r.file_id = files.id
        left join
            users on r.user_id = users.id
        where
            users.publicKey = $publicKey
        order by r.id desc
        `;

  return db.prepare(sql).all({ publicKey: publicKey });
}

/**
 * 取消指定文件的共享属性
 * @param {Database} db
 * @param {Number} fileId 文件 ID，files 表 id 字段
 */
function cancelSharingFile(db, fileId) {
  const sql = 'delete from user_file_relations where file_id = ?';

  db.prepare(sql).run(fileId);
}

/**
 * 注册文件
 * @param {Database} db
 * @param {*} publicKey
 * @param {*} fileInfo
 * @param {*} callback
 */
function registerFile(db, publicKey, fileInfo) {
  if (!db || !publicKey || !fileInfo) {
    throw 'registerFile: 参数不能为空';
  }

  const sql = `select id from users where publicKey = $publicKey`;
  const user = db.prepare(sql).get({ publicKey: publicKey });

  insertFile(db, user.id, fileInfo);
}

/**
 * 新增文件
 * @param {Database} db
 * @param {*} fileInfo
 * @param {*} callback
 */
function insertFile(db, userId, fileInfo) {
  if (!db || !userId || !fileInfo) {
    throw 'insertFile: 参数不能为空';
  }

  let sql = `
        insert into
            files (hash)
        select
            $hash
        where
            not exists(select 1 from files where hash = $hash)
    `;
  db.prepare(sql).run({ hash: fileInfo.hash });

  const file = db
    .prepare('select id from files where hash = $hash')
    .get({ hash: fileInfo.hash });

  sql = `
        insert into
            user_file_relations
                (user_id, file_id, file_name, file_path, file_size)
        select
            $userId, $fileId, $fileName, $filePath, $fileSize
        where
            not exists(select 1 from user_file_relations where user_id = $userId and file_id = $fileId)
    `;

  db.prepare(sql).run({
    userId: userId,
    fileId: file.id,
    fileName: fileInfo.name,
    filePath: fileInfo.path,
    fileSize: fileInfo.size
  });
}

/**
 * 获取下载文件列表
 */
function getDownloadFiles(db) {
  return db.prepare('select * from download_files order by id desc').all();
}

/**
 * 获取下载未完成的文件列表
 */
function getProcessingFiles(db) {
  return db
    .prepare(
      'select * from download_files where status != "completed" order by id desc'
    )
    .all();
}

/**
 * 获取已下载完成文件列表
 * @param {Database} db
 */
function getCompletedFiles(db) {
  return db
    .prepare(
      'select * from download_files where status = "completed" order by id desc'
    )
    .all();
}

/**
 * 根据 hash 查找文件
 * @param {Database} db
 * @param {String} hash
 */
function getFileByHash(db, hash) {
  const sql = `
        select
            r.*, f.hash as file_hash
        from user_file_relations as r
        left join files as f on r.file_id = f.id
        where
            hash = $hash
    `;

  return db.prepare(sql).get({ hash: hash });
}

/**
 * 查找文件
 * @param {Database} db
 * @param {Object} msg
 * @param {String} publicKey
 */
function search(db, msg, publicKey) {
  // let sqlPart = '';

  if (!msg.kw) {
    msg.kw = '';
  }

  const sql = `
        select
            files.id as fid, files.hash, r.file_name, r.file_size, users.publicKey, users.nickname, users.id as uid
        from
            user_file_relations as r
        left join
            files on r.file_id = files.id
        left join
            users on r.user_id = users.id
        where
            users.publicKey = $publicKey
        and
            r.file_name like $kw
        order by r.id desc
        limit $limit
        offset $offset
        `;

  return db.prepare(sql).all({
    kw: '%' + msg.kw + '%',
    publicKey: publicKey,
    offset: msg.page.offset,
    limit: msg.page.limit
  });
}

/**
 * 从正在下载列表中获取文件信息
 * @param {Database}} db
 * @param {String} hash 文件的 hash 值
 */
function getFileFromProcessingFiles(db, hash) {
  const sql = `
        select
            *
        from
            download_files
        where
            file_hash = ? and status = "processing"
        limit 1
    `;

  return db.prepare(sql).get(hash);
}

/**
 * 判断文件是否在已下载列表中
 * @param {Database} db
 * @param {String} fileName
 */
function checkFileInCompletedFiles(db, fileName) {
  const sql = `
        select
            exists(
                select 1 from download_files
                where file_name = ? and status != "completed") as is_exist
    `;

  return db.prepare(sql).get(fileName)['is_exist'];
}

/**
 * 新的下载任务
 * @param {Database} db
 * @param {Object} fileInfo
 * @param {String} downloadPath
 */
function newDownloadFile(db, fileInfo, downloadPath) {
  const sql = `
        insert into download_files (
            file_name,
            file_size,
            file_hash,
            user_nickname,
            user_publicKey,
            save_path
        )
        values (?, ?, ?, ?, ?, ?)
        `;

  db.prepare(sql).run([
    fileInfo.file_name,
    fileInfo.file_size,
    fileInfo.hash,
    fileInfo.nickname,
    fileInfo.publicKey,
    path.resolve(downloadPath, path.basename(fileInfo.file_name))
  ]);
}

/**
 * 获取联系人列表
 * @param {Database} db
 * @param {String} nickname
 */
function getUsers(db, nickname) {
  let sql;

  if (nickname) {
    // 根据昵称搜索联系人
    sql = `
        select *
        from users
        where
            nickname = ?
        order by id desc
    `;

    return db.prepare(sql).all(nickname);
  } else {
    // 获取全部联系人
    sql = 'select * from users';

    return db.prepare(sql).all();
  }
}

/**
 * 移除联系人
 * @param {Database} db
 * @param {Number} id  用户 ID，users 表 id 字段
 */
function removeUser(db, id) {
  const sql = 'delete from users where id = ?';

  db.prepare(sql).run(id);
}

/**
 * 通过公钥获取用户信息
 * @param {*} db
 * @param {*} publicKey
 */
function getUserByPublicKey(db, publicKey) {
  return db.prepare('select * from users where publicKey = ?').get(publicKey);
}

/**
 * 通过公钥获取聊天室信息
 * @param {*} db
 * @param {*} publicKey
 */
function getChatroomByPublicKey(db, publicKey) {
  return db
    .prepare('select * from chatrooms where publicKey = ?')
    .get(publicKey);
}

/**
 * 通过 id 获取聊天室信息
 * @param {*} db
 * @param {*} publicKey
 */
function getChatroomById(db, id) {
  return db.prepare('select * from chatrooms where id = ?').get(id);
}

/**
 * 新增聊天室
 * @param {Database} db
 * @param {String} publicKey
 * @param {String} nickname
 */
function addChatroom(db, publicKey, title, avatar = '', member_num = 0) {
  const sql = `
        insert into
            chatrooms (title, publicKey, avatar, member_num)
        select
            $title, $publicKey, $avatar, $member_num
        where
            not exists(select 1 from chatrooms where publicKey = $publicKey)
    `;

  db.prepare(sql).run({
    publicKey: publicKey,
    title: title,
    avatar: avatar,
    member_num: member_num
  });
}

/**
 * 获取聊天室列表
 * @param {Database} db
 */
function getChatrooms(db) {
  let sql;

  // 获取全部联系人
  sql = 'select * from chatrooms';

  return db.prepare(sql).all();
}

/**
 * 更新用户信息
 * @param {Database} db
 * @param {Object} user
 */
function updateUser(db, user) {
  db.prepare(
    'update users set nickname=$nickname, avatar=$avatar where publicKey=$publicKey'
  ).run({
    nickname: user.nickname,
    avatar: user.avatar,
    publicKey: user.publicKey
  });
}

/**
 * 保存完整消息中的数据内容到数据库
 * @param {Database} db
 * @param {Object} options 需要保存的数据内容
 * @param {String} groupKey 群组唯一标记值
 * @param {String} msgKey 消息唯一标记值
 */
function cacheMessageData(db, options, groupKey = null, msgKey = null) {
  let sql = `SELECT id FROM im_message_data WHERE md5sum = ?`;
  let existsResult = db.prepare(sql).get([options.md5]);
  let dataID = 0;

  if (existsResult) {
    /* 已存在该文件 */
    dataID = existsResult['id'];
  } else {
    /* 不存在该文件 */
    let sql = `
        INSERT INTO
            im_message_data(md5sum, length, size, content)
        VALUES
            (?, ?, ?, ?)`;
    db.prepare(sql).run([
      options.md5,
      options.length,
      options.size,
      options.content
    ]);

    /* 查询 Data ID */
    sql = `SELECT id FROM im_message_data WHERE md5sum = ? AND size = ?`;
    dataID = db.prepare(sql).get([options.md5, options.size])['id'];
  }

  if (msgKey) {
    /* 更新消息表 */
    sql = `UPDATE im_messages SET data_id = ? WHERE key = ? and group_key = ?`;
    db.prepare(sql).run([dataID, msgKey, groupKey]);
  }

  return dataID;
}

/**
 * 存储文件类型消息到消息表
 * @param {Database} db
 * @param {*} options 存储的内容结构
 */
function saveFTMsgToDB(db, options) {
  let sql = `
    INSERT INTO im_messages
        (cmd_type, group_key, key, sender, create_time, type,
          file_name, ext_name, payload, data_id, parents)
    VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  db.prepare(sql).run([
    options.cmd, // 消息的 cmd
    options.groupID, // 发送者公钥
    options.msgKey, // 消息标识符
    options.sender, // 发送者公钥
    options.createTime, // 发送消息时间（client 毫秒）
    options.type, // 消息类型
    options.file_name, // 文件名
    options.ext_name, // 扩展名
    options.payload, //  概述信息
    options.data_id, //  Data 表对应存储 ID 值
    options.parents.join(',')
  ]);
}

/**
 * 缓存消息
 * @param {Database} db
 * @param {String} groupID 群组 ID 值
 * @param {Object} message 消息 JSON
 * @param {String} messageData 非文字类消息的完整数据 DataURL
 */
function cacheMessage(db, groupID, message, messageData = null) {
  let msgKey = message.msg.key; // 消息唯一标识符
  let parents = message.msg.parents; // 消息 Graph Parents
  let type = message.msg.message.type; // 消息类型
  let sender = message.msg.user.publicKey; // 消息发送者
  let createTime = message.msg.timestamp; // 消息发送时间戳

  switch (type) {
    case 'text' /* 文字类消息存储 */:
      {
        let sql = `
          INSERT INTO im_messages
              (cmd_type, group_key, key, sender, create_time, type, payload, parents)
          VALUES
              (?, ?, ?, ?, ?, ?, ?, ?)
        `;

        db.prepare(sql).run([
          message.cmd,
          groupID,
          msgKey,
          sender,
          createTime,
          type,
          message.msg.message.info.text,
          parents.join(',')
        ]);
      }
      break;
    case 'image' /* 图片类消息存储 */:
    case 'file' /* 文件类消息存储 */:
    case 'article' /* 文章类消息存储 */:
      {
        /* 获取文件名称 和 扩展名 */
        let fileName = message.msg.message.info.name;
        let extName = message.msg.message.info.ext;
        let dataID = 0;

        if (messageData) {
          /* 本地存储发送的消息内容 */
          let saveDataOptions = {
            md5: message.msg.message.info.md5sum,
            length: message.msg.message.info.len,
            size: message.msg.message.info.size,
            content: messageData
          };
          dataID = cacheMessageData(db, saveDataOptions, groupID);
        }

        let options = {
          cmd: message.cmd, //消息的 cmd 值
          groupID: groupID, // 群组 ID 值
          msgKey: msgKey, // 消息标识符
          sender: sender, // 发送者公钥
          createTime: createTime, // 发送消息时间戳
          type: type, // 消息类型
          file_name: fileName, // 文件名
          ext_name: extName, // 扩展名
          payload: type == 'file' ? '' : message.msg.message.info.thumbnail, //  概述信息
          data_id: dataID > 0 ? dataID : null, //  Data 表对应存储 ID 值
          parents: parents //消息 Graph Parents
        };
        // 存储消息到消息表
        saveFTMsgToDB(db, options);
      }
      break;
  }
}

/**
 * 通过 ID 获取完整消息内容
 * @param {Database} db
 * @param {Number} dataID
 */
function getMessageDataByID(db, dataID) {
  const sql = `SELECT * FROM im_message_data WHERE id = ?`;
  const dataURL = db.prepare(sql).get([dataID])['content'];

  return dataURL;
}

/**
 * 检索指定的消息是否被缓存
 * @param {Databes} db
 * @param {String} msgKey 消息 Key
 */
function checkMessageIsCached(db, msgKey) {
  let sql = `
    SELECT
      im_messages.*, im_message_data.size, im_message_data.length
    FROM
      im_messages
    LEFT JOIN
      im_message_data on im_messages.data_id = im_message_data.id
    WHERE
      im_messages.key = ?
  `;
  let result = db.prepare(sql).get([msgKey]);
  if (result) {
    return {
      exist: true,
      data: result
    };
  } else {
    return {
      exist: false
    };
  }
}

/**
 * 检索指定的消息数据是否被缓存
 * @param {Databes} db
 * @param {String} msgKey 消息 Key
 */
function checkMsgDataIsCached(db, msgKey) {
  let sql = `
    SELECT data_id FROM im_messages WHERE key = ?
  `
  return db.prepare(sql).get([msgKey])['data_id'];
}

module.exports = exports = {
  initDB: initDB,
  search: search,
  getUsers: getUsers,
  removeUser: removeUser,
  updateUser: updateUser,
  getUserByPublicKey: getUserByPublicKey,
  isUserExists: isUserExists,
  registerUser: registerUser,
  registerFile: registerFile,
  newDownloadFile: newDownloadFile,
  getFileByHash: getFileByHash,
  getSharingFiles: getSharingFiles,
  cancelSharingFile: cancelSharingFile,
  getDownloadFiles: getDownloadFiles,
  getProcessingFiles: getProcessingFiles,
  getCompletedFiles: getCompletedFiles,
  getFileFromProcessingFiles: getFileFromProcessingFiles,
  checkFileInCompletedFiles: checkFileInCompletedFiles,
  getChatroomByPublicKey: getChatroomByPublicKey,
  addChatroom: addChatroom,
  getChatrooms: getChatrooms,
  getChatroomById: getChatroomById,
  cacheMessage: cacheMessage,
  cacheMessageData: cacheMessageData,
  checkMessageIsCached: checkMessageIsCached,
  getMessageDataByID: getMessageDataByID,
  checkMsgDataIsCached: checkMsgDataIsCached
};
