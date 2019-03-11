const { getGroupFromCache } = require('../groups');
const { getContactFromCache } = require('./index');

/**
 * 更新联系人添加状态
 * 如，等待中（waiting）、通过（allow）、拒绝（reject）
 * @param {Database} db  数据库实例
 * @param {String} publicKey 联系人公钥
 * @param {String} status  加入状态
 */
function updateContactStatus(db, publicKey, status) {
  const sql = 'update users set status = ? where publicKey = ?';

  db.prepare(sql).run([status, publicKey]);
}

exports.updateContactStatus = updateContactStatus;
