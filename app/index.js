/**
 * APP 入口
 */

// 加载页面样式
require('./libs/font/iconfont.css');
require('./main.css');
require('./app.css');
require('common.ui-components/icons/iconfont/iconfont.css');
// 加载功能模块
require('./modules');

const App = require('./store');
// 暴露入口给控制台
window.App = App;

const { initAppNoticeModule } = require('./notices/index');
const { initAppGroupCaches } = require('./groups/index');
const { initAppContactCaches } = require('./contacts/index');

const actions = require('./actions');
App.actions = actions;

// 初始化浏览器缓存
initAppNoticeModule();
initAppGroupCaches();
initAppContactCaches();

// 初始化 APP
actions.initApp();
