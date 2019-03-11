const os = require('os');
const fs = require('fs');
const path = require('path');

let App = {
  fn: {},
  _requestId: 0,
  db: null,
  path: {
    user: './',
    download: './'
  },
  user: null,
  identifiers: {
    MAIN: 'file_sharing'
  },
  clients: {
    main: null
  },
  cm: null /* 通讯模块接口 */,
  page: {
    // user1: {
    //     offset: 0,
    //     limit: 5
    // }
  },
  // 记录上次被搜索的公钥地址
  lastSearchPublicKey: null,
  debug: {
    stats: {
      // main: [发送请求数量, 接收请求数量],
      main: {
        send: 0,
        receive: 0
      },
      download: {
        send: 0,
        receive: 0
      }
    }
  },
  // 缓存层
  caches: {},
  // 存储历史请求数据
  requests: {},
  // 记录当前时刻下载任务是否正在运行
  pageLimit: 100,
  downloadTaskRunning: false,
  defaultAvatar: _getDefaultAvatar(),
  groupMap: {},
  // 使用群组的 id 作为 key，存储临时数据
  groupIdMap: {},
  // 消息 map 用于防止重复消息渲染
  messageKeyMap: {},
  // 丢失的消息列表
  missedMessageItemList: [],
  messageGraphManger: null
};

/**
 * 获取默认头像 base64
 */
function _getDefaultAvatar() {
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAEuklEQVRoQ+2ZX0xbVRzHv79bRoCStdJgTdkEanQ6IC4lxhAG4cnEEPDwIARDDKYhBg0RJT7oy6Z9IHuZe5EC+uCIDzzRy6tBIo+TByE12ZBQYHaxwML4v46u95hT7yXYtdCWu1KS/pI+9N7fPef7Ob/fOed3zyWccaMzrh9ZgNOOYDYC2QiccASyKXTcADLGrgN4D8Dnsiz/dpx/svefWwQYYwzAd0RUponinAuAj2RZXkpWaDx/3QEYY1dU4Q3xOuWc3wLwjSzLGycF0Q2AMWZWhXcmIopzvkFEvR6P53Yi/s89Al1dXctra2tmIjqfiCAi+sdqtZ4bGBioJqL7iTwTy0e3CLS0tPDc3Fzxm9/Z2XntiPTZslqta6urq68In7GxsTIiWs4IAE2EyWR6sre35w+FQhGRmhmNxj/D4fDlYDAoiWsVFRVwuVylGROB6FG0WCyP1tfXnxgMhkcWi8W2srJiEj7FxcXo6elBZWWl+JtZAFVVVREOr9f7TFYUFBSgra0NTU1Nh++9TER/Z0wK1dXVob6+HoFAABMTE1he/i+9Gxoa4HQ6YTQao7VmJoCmcm5uDjU1NSgvL483yBeJyJ9xETgsqLq6Oq6+vr6+mz6fz5XqpqbbMtrd3b0RCARMWgodB8A5x+TkJIaGhhAKhVLe1HQDGBwcdBoMhsGcnJwcbSJrENERWFhYgNvths/nO+DknG9xzofHx8e/TCadTgzAGCtzOp2/OhwOOxFBURTs7u5ie3v7QIcGIO5tbW1hcXERo6OjmJ+fj/hwzqcAXCGiGY/HE7eGigWWMoBa+3xGRNeLiorQ0tICh8Nx0Ec4HMbm5iaCwSAEgAYlUkczr9e77na794jognptKi0AjDFRsIlSWRRwB2a329He3g6bzXZwbX9/H/n5+RBAmhkMBpjNZszOzqK/v/9wE2kDmAPwmIjejA6rJEmora2NbFbRa75IscLCwshPmBA/PT2dfgBRuIleFUW5I0mSCH9JNIjYdRsbGyObmoDKy8uDyWRCeD2Ac0VWPFU4Wltbox9LTwQ0AK139U3LEauULikpuedyuS6ZzWbaX/WDD/Tg68Vc5NrsEJtclJ0OgLqSiN10iYiuqqIeKIrilyTp7c7OTjQ3N2P4xreoefgHri3EXTtOD+BQNGY456uSJL2jXRMp1NHRgZGREXx8QcGQP1JNx7LTB1CjMRtrgot7A29wfHI3gyNwFEChgWOkCmidBZ7ymBCZHYGyPI6brwO994D7wTMI8NZ5jq/swI1F4M7mGQR418LRdRG4/YBjfO3Zicw5F2dF4iQvYUupForeB6J745zHnMQf2jjYi8AvD4FB//+6nuKc98qyPJOwctUxrQBflCq4+gLBuw1tL1hWhcvJCtf80wrQ/yrHJSPgD0LpuQvxFpZUusSCTAlAVKNEJM43I8ckiabQ8GUFS4/pr9+30fbpD8mni24AoiH1faCXiK4lCDD1/kvKzx+4x39MNV10BdAaE29kajTEN4CIRU3iTTXPf9JT+InmQCwhjLEGIhIiSzUAsSwCuJXqiUMiwCnNgaMaZoz1cs5LiOh7PT9kxOtTd4BERk1PnyyAnqOZSlvZCKQyano+8y8FTBVPOzDz0AAAAABJRU5ErkJggg==';
}

module.exports = exports.App = App;
