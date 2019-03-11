const { BrowserWindow } = require('electron');
const clipboard = require('electron').clipboard;
const ipc = require('electron').ipcMain;

let subWindow = null;

const _ipcEvents = {
  /**
   * 隐藏当前窗口
   */
  onHideWindow(mainWindow) {
    ipc.on('hide-window', function() {
      console.log('hide-window');
      mainWindow.hide();
      mainWindow.minimize();
    });
  },

  /**
   * 创建截图窗口
   */
  onCreateSubWindow() {
    ipc.on('create-sub-window', function(e, wh) {
      subWindow = new BrowserWindow({
        width: wh[0],
        height: wh[1],
        fullscreen: true,
        resizable: false,
        skipTaskbar: true,
        frame: false,
        alwaysOnTop: true
      });
      subWindow.loadURL('file://' + __dirname + '/sub.html');
    });
  },

  /**
   * 关闭截图窗口
   */
  onCloseSubWindow(mainWindow) {
    ipc.on('close-subwindow', function() {
      subWindow.close();
      mainWindow.show();
    });
  },

  /**
   * 将截图写入剪贴板
   */
  onCut(mainWindow) {
    ipc.on('cut', function(e, arg) {
      subWindow.capturePage(arg, function(image) {
        clipboard.writeImage(image);
        subWindow.close();
        mainWindow.show();
      });
    });
  }
};

/**
 * 绑定截图功能相关 IPC 事件
 */
function bindCaptureEvents(mainWindow) {
  for (let func of Object.values(_ipcEvents)) {
    if (typeof func === 'function') {
      func(mainWindow);
    }
  }
}

exports.bindCaptureEvents = bindCaptureEvents;
