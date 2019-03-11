const { app, Menu, BrowserWindow, ipcMain, Notification } = require('electron');
const { bindCaptureEvents } = require('./capture/capture');
const {
  registerContextMenuListener
} = require('./contextmenu/forword-message');
const process = require('process');

// module.paths.push(path.resolve('node_modules'));
// module.paths.push(path.resolve('./node_modules'));

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win, isDevelopment;

// "scripts": {
//     "start": "export NODE_ENV=development;electron .",
//     "startwin": "set NODE_ENV=development&&electron .",
//     ...
isDevelopment = process.env['NODE_ENV'] === 'development';

function createWindow() {
  // 创建浏览器窗口。
  win = new BrowserWindow({ width: 800, height: 600 });

  ipcMain.on('newMsgNotify', (event, arg) => {
    if (win.isFocused()) {
      // 当前窗口已获得焦点
      return;
    } else {
      // 当前窗口已失去焦点，需要消息提醒
      if (process.platform == 'darwin') {
        if (Notification.isSupported()) {
          let notification = new Notification({
            title: 'Beacon',
            body: 'Received a new message'
          });
          notification.show();
        }
      } else {
        win.flashFrame(true);
      }
    }
  });

  // 然后加载应用的 index.html。
  if (isDevelopment) {
    win.loadURL('http://localhost:2018');
    // 打开开发者工具
    win.webContents.openDevTools();
  } else {
    win.loadFile('./www/index.html');
  }

  // 当 window 被关闭，这个事件会被触发。
  win.on('closed', () => {
    // 取消引用 window 对象，如果你的应用支持多窗口的话，
    // 通常会把多个 window 对象存放在一个数组里面，
    // 与此同时，你应该删除相应的元素。
    win = null;
  });

  var template = [
    {
      label: 'Application',
      submenu: [
        {
          label: 'About Application',
          selector: 'orderFrontStandardAboutPanel:'
        },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: 'Command+Q',
          click: function() {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', selector: 'undo:' },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', selector: 'redo:' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', selector: 'cut:' },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', selector: 'copy:' },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', selector: 'paste:' },
        {
          label: 'Select All',
          accelerator: 'CmdOrCtrl+A',
          selector: 'selectAll:'
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  registerContextMenuListener();
  bindCaptureEvents(win);
}

// Electron 会在初始化后并准备
// 创建浏览器窗口时，调用这个函数。
// 部分 API 在 ready 事件触发后才能使用。
app.on('ready', createWindow);

// 当全部窗口关闭时退出。
app.on('window-all-closed', () => {
  // 在 macOS 上，除非用户用 Cmd + Q 确定地退出，
  // 否则绝大部分应用及其菜单栏会保持激活。
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // 在macOS上，当单击dock图标并且没有其他窗口打开时，
  // 通常在应用程序中重新创建一个窗口。
  if (win === null) {
    createWindow();
  }
});

// 在这个文件中，你可以续写应用剩下主进程代码。
// 也可以拆分成几个文件，然后用 require 导入。
