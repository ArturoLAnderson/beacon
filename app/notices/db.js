const uuidv1 = require('uuid/v1');

/**
 * 获取通知列表
 * @param {Database} db 数据库实例
 */
function getNotices(db) {
  const sql = 'select * from notices order by id desc';

  const notices = db.prepare(sql).all();

  // 将 payload 字符串转换为 JSON 格式
  for (let n of notices) {
    n.payload = JSON.parse(n.payload);
  }

  return notices;
}

exports.getNotices = getNotices;

function getNoticeByKey(db, key) {
  const sql = 'select * from notices where key = ?';

  return db.prepare(sql).get(key);
}

exports.getNoticeByKey = getNoticeByKey;

/**
 * 添加“新联系人”通知
 * @param {Object} payload 通知相关内容
 */
function addNewNotice(db, key, type, payload, status) {
  const sql = `
    insert into
      notices (key, type, payload, status, create_time)
    values
      (?, ?, ?, ?, ?)`;

  const createTime = new Date().valueOf();
  // 插入到数据库
  const stat = db.prepare(sql);
  const info = stat.run([
    key,
    type,
    JSON.stringify(payload),
    status,
    createTime
  ]);

  return {
    id: info.lastInsertROWID,
    key: key,
    type: type,
    payload: payload,
    status: status,
    create_time: createTime
  };
}

exports.addNewNotice = addNewNotice;

/**
 * 更新“通知信息”的状态
 * @param {Database} db 数据库实例
 * @param {Number} id notice ID
 * @param {String} status notice status 字段，接受 waiting、allow、reject、done
 */
function updateNoticeStatus(db, key, status) {
  const sql = 'update notices set status = ? where key = ?';

  db.prepare(sql).run([status, key]);

  return getNoticeByKey(db, key);
}

exports.updateNoticeStatus = updateNoticeStatus;
