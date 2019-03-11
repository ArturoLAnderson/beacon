const { popup } = require('./index');

/**
 * 显示“移除群组”右键菜单
 * @param {Object} options
 */
function popupRemoveGroupMenu(options) {
  const items = [
    {
      accelerator: '',
      label: 'Leave Group',
      role: '',
      enabled: true,
      visible: true,
      click: event => {
        options.onClick && options.onClick(event);
      }
    }
  ];

  popup(items);
}

exports.popupRemoveGroupMenu = popupRemoveGroupMenu;
