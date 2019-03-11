const { popup } = require('./index');

/**
 * 展示转发右键菜单
 * @param {Object} options
 */
function popupForwordMenu(options) {
  const items = [
    {
      accelerator: '',
      label: 'Forword',
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

exports.popupForwordMenu = popupForwordMenu;
