/**
 * 移除群组
 * @param {Database} db 数据库实例
 * @param {Object} group 群组对象
 */
function removeGroupFromDB(db, group) {
  const sql = 'delete from im_groups where id = ?';

  db.prepare(sql).run(group.id);
}

exports.removeGroupFromDB = removeGroupFromDB;
