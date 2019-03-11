/**
 * 获取缓存的消息完整数据
 * @param {Database} db
 * @param {MessageItem} item
 */
function getMsgCachedData(db, item) {
  const itemConfig = item.config;
  const msgInfo = itemConfig.message.info;
  let result;

  if (msgInfo.dataID) {
    const sql = `SELECT * FROM im_message_data WHERE id = ?`;
    result = db.prepare(sql).get([msgInfo.dataID]);
  }

  return result;
}

exports.getMsgCachedData = getMsgCachedData;
