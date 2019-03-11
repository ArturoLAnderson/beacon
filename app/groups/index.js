/***
 * 群组相关，浏览器端缓存处理逻辑
 */

const { popupRemoveGroupMenu } = require('../contextmenu/remove-group');
const { removeGroupFromDB } = require('./db');

/**
 * 初始化群组缓存
 */
function initAppGroupCaches() {
  if (!App.groups) {
    App.groups = {
      list: [],
      map: {}
    };
  }
}

exports.initAppGroupCaches = initAppGroupCaches;

/**
 * 缓存群组
 * @param {Object} newGroup  被缓存的群组对象
 * @param {Boolean} isRewrite  是否重写指定群组
 */
function cacheGroup(newGroup, isRewrite = false) {
  const groups = App.groups;

  const oldGroup = groups.map[newGroup.key];

  if (!oldGroup) {
    groups.list.push(newGroup);
    groups.map[newGroup.key] = newGroup;
  } else {
    if (isRewrite) {
      groups.list[groups.list.indexOf(oldGroup)] = newGroup;
    }
  }
}

exports.cacheGroup = cacheGroup;

/**
 * 从缓存中获取群组信息
 * @param {String} key 群组的唯一标识，key
 */
function getGroupFromCache(key) {
  return App.groups.map[key];
}

exports.getGroupFromCache = getGroupFromCache;

/**
 * 从缓存中移除指定群组
 * @param {Object} group 群组对象
 */
function removeGroupFromCache(group) {
  const groups = App.groups;
  const _group = groups.map[group.key];

  if (_group) {
    groups.list.splice(groups.list.indexOf(_group), 1);
    delete groups.map[group.publicKey];
  }
}

exports.removeGroupFromCache = removeGroupFromCache;

/**
 * 检查指定群组是否是联系人
 * @param {Object} group
 */
function checkIsGroupFromCache(group) {
  const groups = App.groups;

  if (groups.map[group.key]) {
    return true;
  } else {
    return false;
  }
}

exports.checkIsGroupFromCache = checkIsGroupFromCache;

/**
 * 绑定事件，群组列表右键菜单事件
 * @param {Function} onRemoved 移除群组完毕回调函数
 */
function bindEvent_onGroupListContextMenu(onRemoved) {
  $(document).on(
    'contextmenu',
    '#tab__message .message__group__item',
    function() {
      const $item = $(this);
      const group = getGroupFromCache($item.data('groupKey'));

      popupRemoveGroupMenu({
        onClick() {
          if (
            window.confirm(`Leave Group?
              [${group.title}]`)
          ) {
            removeGroupFromCache(group);
            __removeGUIGroup(group);
            removeGroupFromDB(App.db, group);

            onRemoved && onRemoved(group);
          }
        }
      });
    }
  );

  /**
   * 移除界面上的群组相关元素
   * @param {Object} group 群组对象
   */
  function __removeGUIGroup(group) {
    const $panel = $('#tab__message').find('.app__main__lf');

    $panel.find(`[data-group-id="${group.id}"]`).remove();
    $(`#tab__message__group${group.id}`).remove();
  }
}

exports.bindEvent_onGroupListContextMenu = bindEvent_onGroupListContextMenu;
