const {
  Menu,
  MenuItem,
  BrowserWindow,
  ipcMain,
  ipcRenderer
} = require('electron');
const {
  CONTEXT_MENU_CLOSE_CHANNEL,
  CONTEXT_MENU_CHANNEL
} = require('./common');

/**
 * 注册右键菜单事件监听
 */
function registerContextMenuListener() {
  ipcMain.on(
    CONTEXT_MENU_CHANNEL,
    (event, contextMenuId, items, onClickChannel, options) => {
      const menu = createMenu(event, onClickChannel, items);

      menu.popup({
        window: BrowserWindow.fromWebContents(event.sender),
        x: options ? options.x : void 0,
        y: options ? options.y : void 0,
        positioningItem: options ? options.positioningItem : void 0,
        callback: () => {
          event.sender.send(CONTEXT_MENU_CLOSE_CHANNEL, contextMenuId);
        }
      });
    }
  );
}

exports.registerContextMenuListener = registerContextMenuListener;

/**
 * 创建菜单
 * @param {Object} event
 * @param {Function} onClickChannel 菜单项被点击回调函数
 * @param {Array} items 右键菜单项
 */
function createMenu(event, onClickChannel, items) {
  const menu = new Menu();

  items.forEach(item => {
    let menuitem;

    // Separator
    if (item.type === 'separator') {
      menuitem = new MenuItem({
        type: item.type
      });
    }

    // Sub Menu
    else if (Array.isArray(item.submenu)) {
      menuitem = new MenuItem({
        submenu: createMenu(event, onClickChannel, item.submenu),
        label: item.label
      });
    }

    // Normal Menu Item
    else {
      menuitem = new MenuItem({
        label: item.label,
        type: item.type,
        accelerator: item.accelerator,
        checked: item.checked,
        enabled: item.enabled,
        visible: item.visible,
        click: (menuItem, win, contextmenuEvent) => {
          event.sender.send(onClickChannel, item.id, contextmenuEvent);
        }
      });
    }

    menu.append(menuitem);
  });

  return menu;
}

exports.createMenu = createMenu;

let contextMenuIdPool = 0;

/**
 * 弹出右键菜单
 * @param {Array} items
 * @param {Object} options
 */
function popup(items, options) {
  const processedItems = [];

  const contextMenuId = contextMenuIdPool++;
  const onClickChannel = `beacon:onContextMenu${contextMenuId}`;
  const onClickChannelHandler = (_event, itemId, context) => {
    processedItems[itemId].click(context);
  };

  ipcRenderer.once(onClickChannel, onClickChannelHandler);
  ipcRenderer.once(
    CONTEXT_MENU_CLOSE_CHANNEL,
    (_event, closedContextMenuId) => {
      if (closedContextMenuId !== contextMenuId) {
        return;
      }

      ipcRenderer.removeListener(onClickChannel, onClickChannelHandler);

      if (options && options.onHide) {
        options.onHide();
      }
    }
  );

  ipcRenderer.send(
    CONTEXT_MENU_CHANNEL,
    contextMenuId,
    items.map(item => createItem(item, processedItems)),
    onClickChannel,
    options
  );
}

exports.popup = popup;

/**
 * 创建菜单项
 * @param {MenuItem} item 菜单项
 * @param {Array} processedItems 被显示的菜单项列表
 */
function createItem(item, processedItems) {
  const serializableItem = {
    id: processedItems.length,
    label: item.label,
    type: item.type,
    accelerator: item.accelerator,
    checked: item.checked,
    enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
    visible: typeof item.visible === 'boolean' ? item.visible : true
  };

  processedItems.push(item);

  // Submenu
  if (Array.isArray(item.submenu)) {
    serializableItem.submenu = item.submenu.map(submenuItem =>
      createItem(submenuItem, processedItems)
    );
  }

  return serializableItem;
}

exports.createItem = createItem;
