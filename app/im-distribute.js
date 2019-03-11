const Math = require('math');

let sendID = 1;
const groups = {};
const timers = {};
const memberRTO = {};
const memberRTOCount = 3;
const reSendTime = 5000;

// 发送消息封装函数
function doSendMessage(
  client,
  toUser,
  id,
  type,
  message = null,
  next_team = [],
  from_leader = false
) {
  client.send(
    toUser,
    JSON.stringify({
      id: id,
      type: type,
      cmd: 'INSTANT_MESSAGEING',
      msg: message,
      next_team: next_team,
      from_leader: from_leader
    })
  );
}

// 处理转发的群成员超时的问题，最多重试三次发送
function do_memberRTO(client, toUser, id, type, msg) {
  doSendMessage(client, toUser, id, type, msg, [], true);

  memberRTO[toUser].count -= 1;
  if (memberRTO[toUser].count > 0) {
    memberRTO[toUser].handle = setTimeout(function() {
      do_memberRTO(client, toUser, id, type, msg);
    }, reSendTime);
  } else {
    delete memberRTO[toUser];
  }
}

/**
 * 初始化群组分组，或重新分组
 * @param {String} groupKey
 * @param {Array} users 在线群成员
 */
function initGroup(groupKey, users) {
  let usersCount = users.length;
  let groupCount = Math.ceil(Math.sqrt(usersCount));
  let eachGroupCount = usersCount / groupCount;

  let teams = [];
  for (let i = 0; i < usersCount; i += eachGroupCount) {
    const firstLeaderIndex = Math.floor(Math.random() * eachGroupCount);

    teams.push({
      // 确定小组和组长
      team: users.slice(i, i + eachGroupCount),
      first_leader_index: firstLeaderIndex,
      leader_index: firstLeaderIndex
    });
    // [{"team": [addr1, addr2, addr3], "leader": [addr1]}]
  }
  // 根据不同群组 ID 存储
  groups[groupKey] = teams;

  return true;
}

/**
 * 为指定 Client 绑定 onmessaeg 事件
 * Client 收到 type 为 “Request” 的消息时
 * 需要触发回调函数，例如：
 *     收到聊天内容，并渲染到界面
 *
 * @param {NKNClient} client
 * @param {Function} callBack
 */
function bindEvent_On_ImMsg(client, callBack) {
  client.on('message', function(src, payload) {
    let message = JSON.parse(payload);
    if (message.cmd === 'INSTANT_MESSAGEING') {
      // Request 消息
      switch (message.type) {
        case 'Request':
          {
            // 若自己是组长，需要转发消息
            for (let user of message.next_team) {
              // 跳过组长自己
              if (user === client.addr) {
                continue;
              }

              doSendMessage(
                client,
                user,
                message.id,
                'Request',
                message.msg,
                [],
                true
              );

              memberRTO[user] = {
                handle: setTimeout(function() {
                  // 发送的消息没有得到回复，说明组员掉线，最多尝试重新发送三次
                  do_memberRTO(
                    client,
                    user,
                    message.id,
                    'Request',
                    message.msg
                  );
                }, reSendTime),
                count: memberRTOCount
              };
            }
            // 回复消息已收到
            doSendMessage(client, src, message.id, 'Response');
            // 消息内容返回消息给模块调用者
            callBack && callBack(src, message.msg, client.addr);
          }
          break;
        case 'Response':
          {
            if (message.from_leader) {
              // 回复组长转发的消息
              if (memberRTO[src]) {
                clearTimeout(memberRTO[src].handle);
                delete memberRTO[src];
              } else {
                console.log('Timer Error', src);
              }
            } else {
              // 回复群组发的消息
              if (timers[message.id]) {
                clearTimeout(timers[message.id]);
                delete timers[message.id];
              } else {
                console.log('Timer Error', message.id);
              }
            }
          }
          break;
      }
    }
  });
}

function teamMessageNotArrival(notArrivalID, client, group, message) {
  // 首先更换组长
  group.leader_index += 1;

  // 循环了一遍所有小组成员，均发送消息失败，结束循环
  if (group.leader_index === group.first_leader_index + 1) {
    group.leader_index = group.first_leader_index;
    return false;
  }

  // 重新发送未送达的消息给新组长
  doSendMessage(
    client,
    group.leader_index,
    notArrivalID,
    'Request',
    message,
    group.team
  );

  timers[notArrivalID] = setTimeout(function() {
    teamMessageNotArrival(notArrivalID, client, group, message);
  }, reSendTime);
}

function sendMessage(client, groupKey, message) {
  for (let group of groups[groupKey]) {
    // 发送消息给每个小组的组长[用于分发]
    recv_user = group.team[group.leader_index];
    doSendMessage(client, recv_user, sendID, 'Request', message, group.team);

    // 设置消息超时监测
    timers[sendID] = setTimeout(function() {
      // 发送的消息没有得到回复，说明组长掉线，需要更换组长继续发送
      teamMessageNotArrival(sendID, client, group, message);
    }, reSendTime);

    // 发送后累计 ID
    sendID += 1;
  }
}

module.exports = exports = {
  initGroup,
  sendMessage,
  bindEvent_On_ImMsg
};
