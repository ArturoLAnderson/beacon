const fs = require('fs');
const os = require('os');
const path = require('path');
const utils = require('./utils');
const App = require('./store');
const dbCore = require('./db');
const { broadcastGroupMemberStatus } = require('./im-actions');
const auth = require('./auth');
const events = require('./events');
const shell = require('electron').shell;
const { clipboard } = require('electron');
const uuidv1 = require('uuid/v1');
const imGroup = require('./im-group');
const AppWin = require('electron').remote.getCurrentWindow();
const ipc = require('electron').ipcRenderer;
const process = require('process');

const { CommunicateModule } = require('common.communicate/communicate');
const commonUtils = require('common.utils');
const {
  // initChatroomModule,
  initChatroomEvents,
  missingMsgsUICallback
} = require('./chatroom/index');

const { messageGraph } = require('./message');
const { bindEvent_onGroupListContextMenu } = require('./groups');
const baseNotice = require('./notices');
const noticedom = require('./notices/dom');
const baseContact = require('./contacts');

ipc.on('FORWORD_MESSAGE', () => {
  alert('FORWORD_MESSAGE');
});

let downloadSliceSizeKB = 10;

/**
 * 创建 APP 相关目录
 */
function createAppFolders() {
  const appDataPath = utils.getDefaultUserDataPath(process.platform, 'beacon');
  const downloadPath = path.resolve(os.homedir(), 'Downloads');
  const appRootPath = path.resolve(appDataPath, 'userdata');

  if (!fs.existsSync(appRootPath)) {
    utils.mkdirs(appRootPath);
  }

  if (!fs.existsSync(downloadPath)) {
    utils.mkdirs(downloadPath);
  }

  App.path.root = appRootPath;
  App.path.download = downloadPath;
}

/**
 * 创建用户目录
 */
function createUserFolders(publicKey) {
  const appDataPath = utils.getDefaultUserDataPath(process.platform, 'beacon');
  const userDataPath = path.resolve(appDataPath, 'userdata', publicKey);
  const tempDataPath = path.resolve(userDataPath, 'temp');

  if (!fs.existsSync(userDataPath)) {
    utils.mkdirs(userDataPath);
  }

  if (!fs.existsSync(tempDataPath)) {
    utils.mkdirs(tempDataPath);
  }

  App.path.db = userDataPath;
  App.path.user = userDataPath;
  App.path.temp = tempDataPath;
}

/**
 * 连接 NKN 服务器
 * @param {NKN Client} client
 */
function connectNKNServer(client, callback) {
  let $loadingModal = $('#modal--loading');

  $loadingModal.removeClass('v-hide');

  if (client.ws && client.ws.readyState === 1) {
    // 登录成功
    $loadingModal.addClass('v-hide');
    callback && callback();
  } else {
    // NKN Websocket 服务连接未完成，1秒后重试
    setTimeout(() => {
      connectNKNServer(client, callback);
    }, 100);
  }
}

/**
 * 初始化 GUI 交互事件
 */
function initGUIEvents() {
  // 注册表单
  $('#form-register').on('click', _formRegister);
  $('#form-login').on('click', _formLogin);
  $(document).on('click', '#btn--control-share', function() {
    $('#app__file-input').click();
  });

  $('#app__file-input').on('change', function(event) {
    _handleFileUploadChange(this);
  });

  $(document).on('click', '.btn--control-search', function() {
    // 点击搜索按钮时初始化分页参数
    App.page['user' + App.activedUser.id].offset = 0;

    _pageSearch();
  });

  $(document).on('click', '.loadmore--search .loadmore', function() {
    _pageSearch();
  });

  $('[data-target="#tab__my-files"]').on('click', function() {
    loadSharingFiles();
  });

  $(document).on('click', '.app__files__btn--download', function() {
    const $btn = $(this);
    const fileHash = $btn.closest('tr').data('fileHash');
    // 这里的 fileInfo 对象是搜索出来的文件
    const user = App.activedUser;
    const fileInfo = App.caches['user' + user.id][fileHash];

    // fileInfo['user_nickname'] = user.nickname;
    // fileInfo['user_publicKey'] = user.publicKey;
    downloadFile(fileInfo);
  });

  $(document).on('click', '.app__files__btn--pause', function() {
    const $btn = $(this);
    const id = $btn.closest('tr').data('id');
    const db = App.db;

    db.prepare('update download_files set status = "pause" where id = ?').run(
      id
    );
    loadProcessingFiles();
  });

  $(document).on('click', '.btn--badge-dot', function() {
    $(this)
      .find('.badge-dot')
      .addClass('hide');
  });

  $(document).on('click', '.app__files__btn--delete', function() {
    const $btn = $(this);
    const id = $btn.closest('tr').data('id');
    const db = App.db;

    db.prepare('delete from download_files where id = ?').run(id);

    if ($('[data-target="#tab__download--completed"]').hasClass('active')) {
      loadCompletedFiles();
    } else {
      loadProcessingFiles();
    }
  });

  // 重新下载上次下载失败的文件
  $(document).on('click', '.app__files__btn--retry', function() {
    const $btn = $(this);
    const id = $btn.closest('tr').data('id');
    const db = App.db;

    let fileName =
      path.resolve(
        App.path.download,
        $.trim(
          $btn
            .closest('tr')
            .find('td')
            .eq(1)
            .text()
        )
      ) + '.scstemp';

    // 删除之前下载的临时文件
    if (fs.existsSync(fileName)) {
      fs.unlinkSync(fileName);
    }

    db.prepare(
      'update download_files set status = "processing", request_num = 0, save_offset = 0, last_request_time = 0 where id = ?'
    ).run(id);
    $btn
      .removeClass('app__files__btn--retry')
      .addClass('app__files__btn--pause')
      .text('暂停');
    loadProcessingFiles();
  });

  $(document).on('click', '.app__files__btn--continue', function() {
    const $btn = $(this);
    const id = $btn.closest('tr').data('id');
    const db = App.db;

    db.prepare(
      'update download_files set status = "processing", request_num = 0 where id = ?'
    ).run(id);
    loadProcessingFiles();
    downloadTask();
  });

  $(document).on(
    'click',
    '[data-target="#tab__download--completed"]',
    function() {
      loadCompletedFiles();
    }
  );

  $('.btn--control-open-download-dir').on('click', function() {
    const dirPath = $(this)
      .closest('.form-group')
      .find('[name="download-dir"]')
      .val();
    shell.openItem(dirPath);
  });

  $('#ping-client').on('click', _sendPing);

  $('#ping-clear').on('click', function() {
    let stats = App.debug.stats;
    stats.main.send = 0;
    stats.main.receive = 0;
    refreshDebugPanel();
  });

  $('#ping-refresh').on('click', function() {
    window.location.reload();
  });

  $('#debug-opendevtools').on('click', function() {
    AppWin.webContents.openDevTools();
  });

  $('.btn--control-set-slice-size').on('click', function() {
    let _button = $('.btn--control-set-slice-size');
    switch (_button.text()) {
      case 'Set':
        $('.download-slice-size').prop('disabled', false);
        _button.text('Done');
        break;
      case 'Done':
        if ($('.download-slice-size').val() != '') {
          downloadSliceSizeKB = parseInt($('.download-slice-size').val());
        } else {
          $('.download-slice-size').val(downloadSliceSizeKB.toString());
        }
        $('.download-slice-size').prop('disabled', true);
        _button.text('Set');
        console.log($('.download-slice-size').val(), downloadSliceSizeKB);
        break;
    }
  });

  $(document).on('click', '.btn--add-user', function() {
    $('#modal--add-user').removeClass('v-hide');
  });

  /**
   * 弹出层中 添加联系人 按钮点击事件
   */
  $('#btn--control-add-user').on('click', function() {
    const $btn = $(this);
    const publicKey = $btn
      .parent()
      .find('.search-public-key')
      .val();

    // 公钥长度校验
    if (publicKey.length !== 66) {
      alert('Incorrect address length.');
      return;
    }

    // 禁止添加自己为联系人
    if (publicKey === App.user.publicKey) {
      alert('Can not add your self.');
      return;
    }

    // 检查是否已经添加过该联系人
    if (baseContact.checkIsContactFromCache({ publicKey: publicKey })) {
      alert('The address is already in contact list.');
      return;
    }

    $(this).trigger('modal.close');

    // 申请添加为联系人
    sendAddContactRequest(publicKey);
  });

  // 列表联系人点击事件
  $(document).on('click', '.user-list__item', function() {
    const publicKey = $.trim($(this).data('publicKey'));
    const user = dbCore.getUserByPublicKey(App.db, publicKey);

    App.activedUser = user;
    let $userPanel = $('#user-tab' + user.id);
    if ($userPanel.length === 0) {
      const html = getUserPanelHtml(user);

      $userPanel = $(html);
      $userPanel.data('user', user);
      $('#tab__user-panel').append($userPanel);

      App.page['user' + user.id] = {
        offset: 0,
        limit: App.pageLimit
      };

      App.caches['user' + user.id] = {};
    }

    $userPanel.siblings('.show').removeClass('show');
    $userPanel.addClass('show');

    setTimeout(() => {
      if (App.page['user' + user.id].offset === 0) {
        $userPanel.find('.btn--control-search').trigger('click');
      }
    }, 100);
  });

  // form-group 中的复制按钮触发的点击事件
  $(document).on('click', '.btn--control-copy', function() {
    const $btn = $(this);
    const publicKey = $btn
      .parent()
      .siblings('.copy-input')
      .val();
    clipboard.writeText(publicKey, 'publicKey');
    if (clipboard.readText('publicKey') === publicKey) {
      $btn.text('copied');
      setTimeout(() => {
        $btn.text('copy');
      }, 3000);
    } else {
      alert('copy failed');
    }
  });

  // 打开 APP 数据目录
  $(document).on('click', '#btn--control-show-root-dir', function() {
    shell.openItem(App.path.root);
  });

  onBtnCaptureClick();
  onImportBakFiles_FolderInputChange();
  _bindEvent_onContactTabBtnClick();
  bindEvent_onCancelFileShareStateBtnClick();
  bindEvent_onGroupListContextMenu(group => {
    const user = App.user;

    // 将离开群组消息广播给群成员
    broadcastGroupMemberStatus(group, [
      {
        nickname: user.nickname,
        publicKey: user.publicKey,
        isInGroup: false,
        isOnline: false
      }
    ]);
  });
}

/**
 * 导入备份文件的 input 组件 onchange 事件
 */
function onImportBakFiles_FolderInputChange() {
  $(document).on('change', '#app__folder-input', function() {
    const folderPath = this.value;
    utils.log('onImportBakFiles_FolderInputChange', folderPath);
    if (!folderPath || folderPath === '') {
      return;
    }

    auth.exportUserFiles(App, this.files[0].path);
    utils.showTopMsg('Export OK.');
  });
}

/**
 * 取消指定文件的共享
 */
function bindEvent_onCancelFileShareStateBtnClick() {
  $(document).on('click', '#tab__upload-files .btn--remove', function() {
    const $tr = $(this).closest('tr');
    const fid = $tr.data('fileId');

    if (
      window.confirm(`Stop sharing ?
      [${$.trim($tr.find('.filename').text())}]`)
    ) {
      dbCore.cancelSharingFile(App.db, fid);
      $tr.remove();
    }
  });
}

/**
 * 发送 PING 请求
 */
function _sendPing() {
  const publicKey = $.trim($('[name="search-publicKey"]').val());

  if (publicKey.length !== 66) {
    alert('查询的公钥地址不能为空或长度不正确');
    return;
  }

  utils.log('测试 nkn 连接状态，发送 PING');

  let payload = {
    type: 'Request',
    cmd: 'PING'
  };

  let opts = {
    toUser: App.identifiers.MAIN + '.' + publicKey,
    data: JSON.stringify(payload),
    needACK: true,
    needResponse: true,
    onSuccess: () => {},
    onError: () => {},
    onResponse: (src, payload) => {
      events.clientPing(src, JSON.parse(payload));
    }
  };
  utils.cmSend(opts);
}

/**
 * 分页搜索
 */
function _pageSearch() {
  const user = App.activedUser;
  const publicKey = user.publicKey;
  const $userPanel = $('#tab__contact_u' + user.id);
  let keyword = $userPanel.find('[name="search-keyword"]').val();

  if (publicKey.length !== 66) {
    alert('查询的公钥地址不能为空或长度不正确');
    return;
  }

  let payload = {
    type: 'Request',
    cmd: 'SEARCH_FILE',
    request_id: getRequestId(),
    msg: {
      kw: keyword,
      page: App.page['user' + user.id]
    }
  };

  let $loadmore = $userPanel.find('.loadmore--search');
  let opts = {
    toUser: App.identifiers.MAIN + '.' + publicKey,
    data: JSON.stringify(payload),
    needACK: true,
    needResponse: true,
    onSuccess: () => {},
    onError: () => {
      utils.showTopMsg('load failed, please retry.');
      changeLoadmore($loadmore, 'loadmore');
    },
    onResponse: (src, payload) => {
      events.clientSearchFile(src, JSON.parse(payload));
    }
  };

  changeLoadmore($loadmore, 'loading');
  utils.cmSend(opts);
}

function getRequestId() {
  App._requestId += 1;
  return App._requestId;
}

/**
 * 根据查询回数据的数量判断“加载更多”面板的显示状态
 * @param {*} $panel
 * @param {*} status loadmore 组件状态['loading', 'loadmore', 'no-more']
 */
function changeLoadmore($panel, status) {
  if (!$panel || !status) {
    throw 'changeLoadmore: 参数不能为空';
  }

  $panel.find('.show').removeClass('show');
  $panel.find('.' + status).addClass('show');
}

/**
 * 备份用户认证信息
 */
function bakAuth() {
  let filePath = path.resolve(App.path.root, 'auth.json');
  fs.writeFileSync(filePath, JSON.stringify(App.user));
}

/**
 * 加载用户认证信息
 */
function loadAuth() {
  let filePath = path.resolve(App.path.root, 'auth.json');

  if (!fs.existsSync(filePath)) {
    return;
  }

  let result = JSON.parse(fs.readFileSync(filePath));

  App.user = result;

  // $('.app__auth__login').find('[name="nickname"]').val(result.nickname);
  // $('.app__auth__login').find('[name="privateKey"]').val(result.privateKey);
  loadAccounts();
}

/**
 * 加载账户列表
 */
function loadAccounts() {
  const _auth = auth.loadWallet(App);
  utils.log('auth', _auth);
  // 无钱包文件，返回
  if (!_auth || _auth.accounts.length === 0) {
    return;
  }

  $('.app__auth__login').removeClass('uic-hide');
  $('.app__auth__hr').removeClass('uic-hide');

  const accounts = _auth.accounts;
  const lastAccount = _auth.accounts[_auth.lastLoginPublicKey];
  const $nickname = $('.app__auth__login').find('[name="nickname"]');

  let optionsHtml = '';
  let keys = Object.values(accounts);
  for (let _a of keys) {
    optionsHtml += `<option value="${_a.publicKey}">${
      _a.nickname
    }(${utils.formatPublicKey(_a.publicKey)})</option>`;
  }
  utils.log(optionsHtml, _auth.lastLoginPublicKey);
  $nickname
    .empty()
    .html(optionsHtml)
    .val(_auth.lastLoginPublicKey);

  if (keys.length > 0) {
    $nickname.val(_auth.lastLoginPublicKey);
  }
}

function renderGUI() {
  $('.app__auth').addClass('hide');
  $('.app__logged').removeClass('hide');
  $('[name="my-publickey"]').val(App.user.publicKey);
  $('[name="download-dir"]').val(path.resolve(App.path.download));
  loadSharingFiles();
  loadProcessingFiles();

  $('#info-me').html(getIMUserItemHtml(App.user));
  imGroup.init();
  setTimeout(() => {
    $('#info-me')
      .find('.user-list__item')
      .trigger('click');
  }, 500);
}

/**
 * 创建通讯模块接口
 */
function createCM(privateKey, onSuccess) {
  App.cm = new CommunicateModule();

  App.cm.createClient(
    App.identifiers.MAIN /* identifiers */,
    10000 /* 重试次数 */,
    100 /* 重试间隔 ms */,
    client => {
      /* 创建成功回调 */
      onSuccess && onSuccess(client);
    },
    () => {
      /* 创建失败回调 */
      alert('network error.');
      App.cm = null;
    },
    privateKey,
    App.seedRpcServerAddr
  );
}

exports.createCM = createCM;

/**
 * 注册表单提交事件
 */
function _formRegister() {
  let nickname = $.trim(
    $('.app__auth__register')
      .find('[name="nickname"]')
      .val()
  );
  let password = $.trim(
    $('.app__auth__register')
      .find('[name="password"]')
      .val()
  );
  let password2 = $.trim(
    $('.app__auth__register')
      .find('[name="password2"]')
      .val()
  );

  if (nickname === '') {
    alert('Nickname cannot be empty.');
    return;
  }

  if (password === '' || password2 === '') {
    alert('Password cannot be empty.');
    return;
  }

  if (
    password.length < 6 ||
    password.length > 20 ||
    password2.length < 6 ||
    password2.length > 20
  ) {
    alert('Password only allows 6 ~ 20 characters.');
    return;
  }

  if (password !== password2) {
    alert('Two passwords entered differently.');
    return;
  }

  utils.showTopMsg('logging in ...', 60000);

  createCM(null, client => {
    App.clients.main = client;
    initAuth(client, nickname, password);
    auth.newAccount(App, App.user, password);
    utils.hideTopMsg();
    renderGUI();
    events.initEvents();
  });
}

/**
 * 登录表单提交事件
 */
function _formLogin() {
  let $nickname = $('.app__auth__login').find('[name="nickname"]');
  // let nickname = $.trim($nickname.val());
  let password = $.trim(
    $('.app__auth__login')
      .find('[name="password"]')
      .val()
  );

  // if (nickname === '') {
  //   alert('Nickname can not be empty.');
  //   return;
  // }

  if (password === '') {
    alert('Password can not be empty.');
    return;
  }

  if (password.length < 6 || password.length > 20) {
    alert('Password only allows 6 ~ 20 characters.');
    return;
  }

  let userInfo = auth.login(App, $nickname.val(), password);

  if (!userInfo) {
    return;
  }

  utils.showTopMsg('logging in ...', 60000);

  createCM(userInfo.privateKey, client => {
    App.clients.main = client;
    initAuth(client, userInfo.nickname);
    renderGUI();
    setTimeout(() => {
      utils.hideTopMsg();
      events.initEvents();
    }, 0);
  });
}

/**
 * 处理文件上传组件 onChange 事件
 * @param {*} fileDom
 */
async function _handleFileUploadChange(fileDom) {
  // 未选择文件，直接返回
  if (!fileDom.files || fileDom.files.length === 0) {
    return;
  }

  const _files = [];
  const _sizeLimit = 2 * 1024 * 1024 * 1024;

  for (const fileInfo of fileDom.files) {
    if (fileInfo.size > _sizeLimit) {
      utils.showTopMsg('Excessive file size, 2G allowed', 2 * 1000);
      continue;
    }

    const fileHash = await utils.getFileMd5(fileInfo.path);

    _files.push({
      name: fileInfo.name,
      hash: fileHash,
      size: fileInfo.size,
      path: fileInfo.path
    });
  }

  for (const fileInfo of _files) {
    shareFile(fileInfo);
  }

  setTimeout(() => {
    loadSharingFiles();
  }, 100);
}

/**
 * 分享文件
 * @param {*} fileInfo
 */
function shareFile(fileInfo) {
  if (!fileInfo || typeof fileInfo !== 'object') {
    throw 'shareFile: fileInfo 不能为空且必须为一个 Object';
  }

  dbCore.registerFile(App.db, App.user.publicKey, fileInfo);
}

/**
 * 初始化身份验证信息
 * @param {*} client
 * @param {*} nickname
 */
function initAuth(client, nickname, password) {
  if (!App.user) {
    App.user = {
      nickname: nickname,
      publicKey: client.key.publicKey,
      privateKey: client.key.privateKey,
      avatar: App.defaultAvatar
    };
  }

  createUserFolders(App.user.publicKey);
  App.db = dbCore.initDB(App.path.db);

  // bakAuth();

  dbCore.registerUser(
    App.db,
    client.key.publicKey,
    nickname,
    App.user.avatar,
    0,
    'allow'
  );
  // // 初始化聊天室模块
  // initChatroomModule(App);

  App.messageGraphManger = new messageGraph();
  App.messageGraphManger.getMissingMsgsDispatch(missingMsgsUICallback);
}

/**
 * 获取全屏截图
 */
function getScreenImg(done) {
  var desktopCapturer = require('electron').desktopCapturer;

  desktopCapturer.getSources(
    {
      types: ['screen'],
      thumbnailSize: {
        width: screen.width,
        height: screen.height
      }
    },
    function(error, sources) {
      if (error) throw error;
      localStorage['img'] = sources[0].thumbnail.toDataURL();
      done && done();
    }
  );
}

/**
 * 截图按钮点击事件
 */
function onBtnCaptureClick() {
  $(document).on('click', '.btn--capture', function() {
    ipc.send('hide-window');
    getScreenImg(() => {
      ipc.send('create-sub-window', [screen.width, screen.height]);
    });
  });
}

/**
 * 初始化 APP
 */
function initApp() {
  createAppFolders();
  loadAccounts();
  // loadAuth();
  initGUIEvents();
}

/**
 * 加载我分享的文件列表
 */
function loadSharingFiles() {
  const files = dbCore.getSharingFiles(App.db, App.user.publicKey);
  const $list = $('#tab__upload-files').find('.app__files__wrapper tbody');
  let html = '';

  for (let item of files) {
    let temp =
      '<tr data-public-key="' +
      item.publicKey +
      '" data-file-id="' +
      item.fid +
      '">';
    temp += '<td><div class="nickname">' + item['nickname'] + '</div></td>';
    temp += '<td><div class="filename">' + item['file_name'] + '</div></td>';
    temp += '<td>' + (item['file_size'] / 1000).toFixed(2) + '</td>';
    temp +=
      '<td><div class="table__controls"><a href="javascript:;" class="btn--remove"><i class="iconfont icon-wrong"></i></a></div></td>';
    temp += '</tr>';
    html += temp;
  }

  $list.empty().html(html);
}

/**
 * 获取下载中的文件列表
 */
function loadProcessingFiles() {
  const files = dbCore.getDownloadFiles(App.db);
  const $list = $('#tab__download--loading').find('.app__files__wrapper tbody');
  let html = '';

  for (let item of files) {
    let temp =
      '<tr data-public-key="' + item.publicKey + '" data-id="' + item.id + '">';
    // <i class="iconfont icon-close"></i>
    if (item.status === 'processing') {
      let finishProgress = (((item['save_offset'] / item['file_size']) * 100).toFixed(2)).toString()
      temp +=
        '<td><progress max="100" value="' + finishProgress +'" class="download-progress">progress</progress></td>';
    } else if (item.status === 'pause') {
      temp +=
        '<td><i class="iconfont icon-pause" style="color: #f7ab00;"></i></td>';
    } else if (item.status === 'fail') {
      temp +=
        '<td><i class="iconfont icon-error" style="color: red;"></i></td>';
    } else {
      temp +=
        '<td><i class="iconfont icon-check" style="color: green;"></i></td>';
    }

    temp += '<td>' + item['user_nickname'] + '</td>';
    temp +=
      '<td><div class="filename uic-text-ellipsis" title="' +
      item['file_name'] +
      '">' +
      item['file_name'] +
      '</div></td>';

    temp += '<td>' + (item['file_size'] / 1000).toFixed(2) + '</td>';
    temp +=
      '<td>' +
      ((item['save_offset'] / item['file_size']) * 100).toFixed(2) +
      '%</td>';

    if (item.status === 'processing') {
      temp +=
        '<td><a href="javascript:;" class="app__files__btn--pause">pause</a></td><td><a href="javascript:;" class="app__files__btn--delete">delete</a></td>';
    } else if (item.status === 'pause') {
      temp +=
        '<td><a href="javascript:;" class="app__files__btn--continue">continue</a></td><td><a href="javascript:;" class="app__files__btn--delete">delete</a></td>';
    } else if (item.status === 'fail') {
      temp +=
        '<td><a href="javascript:;" class="app__files__btn--retry">failed, retry</a></td><td><a href="javascript:;" class="app__files__btn--delete">delete</a></td>';
    } else {
      temp +=
        '<td></td><td><a href="javascript:;" class="app__files__btn--delete">delete</a></td>';
    }

    temp += '</tr>';
    html += temp;
  }

  $list.empty().html(html);
}

function loadCompletedFiles() {
  const files = dbCore.getCompletedFiles(App.db);

  if (files) {
    const $list = $('#tab__download--completed').find(
      '.app__files__wrapper tbody'
    );
    let html = '';

    for (let item of files) {
      let temp =
        '<tr data-public-key="' +
        item.publicKey +
        '" data-id="' +
        item.id +
        '">';
      temp += '<td>' + item['user_nickname'] + '</td>';
      temp +=
        '<td><div class="filename uic-text-ellipsis" title="' +
        item['file_name'] +
        '">' +
        item['file_name'] +
        '</div></td>';
      temp += '<td>' + (item['file_size'] / 1000).toFixed(2) + '</td>';
      temp +=
        '<td><a href="javascript:;" class="app__files__btn--delete">delete</a></td>';
      temp += '</tr>';
      html += temp;
    }
    $list.empty().html(html);
  }
}

/**
 * 将 user 对象转换为 IM 列表中的 user HTML
 * @param {Object} user
 */
function getIMUserItemHtml(user) {
  return `<div class="user-list__item tab__nav__item" data-target="#tab__user-panel" data-public-key="${
    user.publicKey
  }">
            <div class="avatar__warpper">
                <img src="${user.avatar}" class="avatar">
            </div>
            <div class="info">
                <span class="nickname">${user.nickname}</span><br>
                <small class="public-key" data-public-key="${
                  user.publicKey
                }">${utils.formatPublicKey(user.publicKey)}</small>
            </div>
        </div>
    `;
}

/**
 * 发送请求并统计
 * @param {*} src
 * @param {*} payload
 */
function clientSend(src, payload) {
  let _payload = payload;

  if (typeof _payload !== 'string') {
    _payload = JSON.stringify(payload);
  }

  App.cm.sendMessage(
    src,
    _payload,
    true,
    false,
    3,
    commonUtils.calcRetryTime(_payload),
    () => {
      /* 发送成功回调*/
    },
    () => {
      /* 发送失败回调 */
    }
  );
  utils.debugAddStats('main', 'send');
}

/**
 *
 * @param {*} requestId
 */
function setRequestDone(requestId) {
  if (!requestId) {
    return;
  }

  if (App.requests[requestId]) {
    App.requests[requestId].isDone = true;
  }
}

/**
 * 刷新 Debug 面板统计数据
 */
function refreshDebugPanel() {
  let stats = App.debug.stats;
  $('#client1__send-count').text(stats.main.send);
  $('#client1__receive-count').text(stats.main.receive);
}

/**
 * 下载文件
 * @param {*} fileInfo
 */
function downloadFile(fileInfo) {
  utils.log('downloadfile', fileInfo);
  // 判断有没有未完成的任务与 file_name 重名
  const isExist = dbCore.checkFileInCompletedFiles(
    App.db,
    fileInfo['file_name']
  );

  if (isExist) {
    alert('File already exists in the download list.');
  } else {
    dbCore.newDownloadFile(App.db, fileInfo, App.path.download);
    utils.showTopMsg('Add to download list successful.', 2000);
    $('#btn--show-download-panel')
      .find('.badge-dot')
      .removeClass('hide');
    downloadTask();
    loadProcessingFiles();
  }
}

/**
 * 执行下载动作
 * @param {*} isTimer 是否是定时器中触发
 */
function downloadTask() {
  if (App.downloadTaskRunning) {
    return;
  }

  utils.log('downloadTask');
  const db = App.db;
  App.downloadTaskRunning = true;

  // 寻找未下载完成的文件
  const files = dbCore.getProcessingFiles(App.db);

  let identifier;

  identifier = App.identifiers.MAIN;

  for (let fileInfo of files) {
    if (fileInfo.status === 'processing') {
      let timestamp = new Date().getTime();
      let isTimeout =
        timestamp - fileInfo['last_request_time'] > 60000 &&
        fileInfo['last_request_time'] > 0;

      //new task or new block, or retry
      if (
        fileInfo.request_num === 0 ||
        (fileInfo.request_num > 0 && fileInfo.request_num < 3 && isTimeout) //timeout
      ) {
        db.prepare(
          'update download_files set request_num = ? , last_request_time = ? where id = ?'
        ).run([fileInfo.request_num + 1, timestamp, fileInfo.id]);

        let payload = {
          type: 'Request',
          cmd: 'DOWNLOAD_FILE',
          msg: {
            file_hash: fileInfo['file_hash'],
            // fragment_size: 1024 * 1024,
            fragment_size: downloadSliceSizeKB ? downloadSliceSizeKB * 1024 : 10 * 1024,
            save_offset: fileInfo['save_offset']
          }
        };
        utils.log('send request DOWNLOAD_FILE', payload);

        let opts = {
          toUser: identifier + '.' + fileInfo.user_publicKey,
          data: JSON.stringify(payload),
          needACK: true,
          needResponse: true,
          onSuccess: () => {},
          onError: () => {},
          onResponse: (src, payload) => {
            events.clientDownloadFile(src, JSON.parse(payload));
          }
        };
        utils.cmSend(opts);
      } else if (fileInfo.request_num >= 3 && isTimeout) {
        db.prepare(
          'update download_files set status = "fail" where id = ?'
        ).run(fileInfo.id);
      } else {
        // wait
      }
    }
  }

  App.downloadTaskRunning = false;
}

/**
 * 生成用户面板的 HTML
 * @param {Object} user
 */
function getUserPanelHtml(user) {
  const html = `
    <div id="user-tab${user.id}" class="user-tab">
        <nav class="tab__theme--main">
            <div class="tab__navs">
                <a href="javascript:;" data-target="#tab${
                  user.id
                }__message" class="tab__nav__item active" data-toggle="tab">chat</a>
                <a href="javascript:;" data-target="#tab${
                  user.id
                }__search" class="tab__nav__item" data-toggle="tab">files</a>
                <a href="javascript:;" data-target="#tab${
                  user.id
                }__user-info" class="tab__nav__item" data-toggle="tab">info</a>
            </div>
        </nav>
        <div id="tab${
          user.id
        }__message" class="tab__message tab__content__pane show">
            <div class="app__message">
                <div class="app__message__talks">
                    <div class="inner"></div>
                </div>
                <div class="app__message__editor">
                    <!--此处放置编辑器工具栏-->
                    <textarea placeholder="Press enter to send message."></textarea>
                </div>
            </div>
        </div>
        <div id="tab${user.id}__search" class="tab__content__pane">
            <div class="app__files">
                <div class="form-group hide">
                    <span class="form-group__addon">地址:</span>
                    <input type="text" class="form-group__item" name="search-publicKey" value="${
                      user.publicKey
                    }">
                </div>
                <div class="form-group">
                    <span class="form-group__addon">KeyWord:</span>
                    <input type="text" class="form-group__item" name="search-keyword">
                    <span class="form-group__addon">
                        <a href="javascript:;" class="btn btn--link btn--control-search">搜索</a>
                    </span>
                </div>
                <div class="form-group">
                    <div class="app__files__wrapper">
                        <table class="">
                            <thead>
                                <tr class="">
                                    <th>用户</th>
                                    <th>文件名</th>
                                    <th>大小(KB)</th>
                                </tr>
                            </thead>
                            <tbody class="">
                            </tbody>
                        </table>
                        <div class="loadmore-panel loadmore--search">
                            <span class="loadmore__item no-more">
                                <small>没有更多了</small>
                            </span>
                            <span class="loadmore__item loading">
                                <small>正在搜索...</small>
                            </span>
                            <a href="javascript:;" class="loadmore__item btn--link btn--loadmore loadmore">查询更多</a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <div id="tab${user.id}__user-info" class="tab__content__pane">
            <div class="form-group no-border">
                <span class="form-group__addon">昵称:</span>
                <input type="text" class="form-group__item" value="${
                  user.nickname
                }" readonly>
            </div>
            <div class="form-group no-border">
                <span class="form-group__addon">地址:</span>
                <input type="text" class="form-group__item copy-input" value="${
                  user.publicKey
                }" readonly>
                <span class="form-group__addon">
                    <a href="javascript:;" class="btn btn--link btn--control-copy">复制</a>
                </span>
            </div>
        </div>
    </div>
    `;
  return html;
}

/**
 * 发送添加联系人请求
 * @param {String} publicKey 被添加联系人的公钥
 */
function sendAddContactRequest(publicKey) {
  const sender = App.user;
  const notice = baseNotice.createAddContactNotice({
    sender: {
      nickname: sender.nickname,
      publicKey: sender.publicKey
    },
    receiver: {
      nickname: commonUtils.formatPublicKey(publicKey),
      publicKey: publicKey
    },
    status: 'waiting'
  });
  noticedom.setNoticeBadge('show');

  const payload = {
    type: 'Request',
    cmd: 'ADD_CONTACT',
    msg: {
      sender: {
        nickname: sender.nickname,
        publicKey: sender.publicKey
      },
      notice: {
        key: notice.key,
        type: notice.type,
        payload: notice.payload,
        status: notice.status,
        createTime: notice['create_time']
      }
    }
  };

  let opts = {
    toUser: `${App.identifiers.MAIN}.${publicKey}`,
    data: JSON.stringify(payload),
    needACK: true,
    needResponse: false,
    onSuccess: () => {},
    onError: () => {}
  };
  utils.cmSend(opts);
}

/**
 * 发送获取用户信息的请求
 * @param {String} publicKey
 */
function sendUserInfoRequest(publicKey) {
  const payload = {
    type: 'Request',
    cmd: 'USER_INFO',
    request_id: getRequestId()
  };

  let opts = {
    toUser: `${App.identifiers.MAIN}.${publicKey}`,
    data: JSON.stringify(payload),
    needACK: true,
    needResponse: true,
    onSuccess: () => {},
    onError: () => {},
    onResponse: (src, payload) => {
      events.clientUserInfo(src, JSON.parse(payload));
    }
  };
  utils.cmSend(opts);
}

/**
 * 刷新联系人用户状态（在线、离线）
 * @param {Array} users
 */
function refreshContactsStatus(users) {
  const identifier = App.identifiers.MAIN;
  for (let u of users) {
    let payload = {
      type: 'Request',
      cmd: 'PING',
      request_id: App.actions.getRequestId()
    };

    // 请求用户状态，若请求失败，重传 1 次
    clientSend(`${identifier}.${u.publicKey}`, payload, 1);
  }
}

/**
 * 更新界面显示的联系人状态
 * @param {*} publicKey
 */
function updateGUIContactStatus(publicKey) {
  const user = dbCore.getUserByPublicKey(App.db, publicKey);

  if (user) {
    const $wrapper = $('#tab__contact--contact');
    const $contact = $wrapper.find(`[data-item-id="${user.id}"]`);

    $contact.removeClass('outline');
    $contact.find('.status').text('[online] ');

    $wrapper.append($wrapper.find('.outline'));
  }
}

/**
 * 绑定事件，联系人选项卡按钮点击事件
 */
function _bindEvent_onContactTabBtnClick() {
  $(document).on('click', '.contacts__bd .tab__nav__item', function() {
    $($(this).data('target'))
      .find('.active')
      .trigger('click');
  });
}

module.exports = exports = {
  initApp: initApp,
  bakAuth: bakAuth,
  getRequestId: getRequestId,
  initGUIEvents: initGUIEvents,
  createAppFolders: createAppFolders,
  connectNKNServer: connectNKNServer,
  refreshDebugPanel: refreshDebugPanel,
  clientSend: clientSend,
  setRequestDone: setRequestDone,
  refreshContactsStatus: refreshContactsStatus,
  updateGUIContactStatus: updateGUIContactStatus,
  downloadTask: downloadTask,
  loadProcessingFiles: loadProcessingFiles,
  changeLoadmore: changeLoadmore,
  sendUserInfoRequest: sendUserInfoRequest,
  sendAddContactRequest: sendAddContactRequest
};
