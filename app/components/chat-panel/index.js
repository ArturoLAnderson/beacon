/**
 * 获取聊天列表面板 HTML
 */
function getChatTalkPanelHtml() {
  return `
        <div class="message__group__talks">
            <div class="inner"></div>
        </div>
    `;
}

/**
 * 添加聊天内容到指定聊天面板
 * @param {*} $talkPanel 聊天面板的 jQuery 对象
 * @param {*} TalkItemHtml 聊天内容 HTML
 */
function appendTalkItemToTalkPanel($talkPanel, talkItemHtml) {
  $talkPanel.find('.inner').append(talkItemHtml);
}

/**
 * 获取一条聊天内容的 HTML
 * @param {*} pos 聊天内容显示位置，'left' 或 'right'
 * @param {*} item 聊天内容信息
 *            {
 *                user: {
 *                    nickname: '昵称',
 *                    avatar: '头像'
 *                },
 *                message: '聊天信息'
 *            }
 */
function getChatTalkItemHtml(pos = 'left', item) {
  let html = '';

  if (pos === 'right') {
    html += `
            <div class="talk__item talk__item--right">
                <div class="talk__item__bd">
                    <div class="nickname">
                        ${item.user.nickname}
                    </div>
                    <div class="content">
                        ${item.message}
                    </div>
                </div>
                ${getAvatarHtml(item.user.avatar)}
            </div>
        `;
  } else {
    html += `
            <div class="talk__item">
                ${getAvatarHtml(item.user.avatar)}
                <div class="talk__item__bd">
                    <div class="nickname">
                        ${item.user.nickname}
                    </div>
                    <div class="content">
                        ${item.message}
                    </div>
                </div>
            </div>
        `;
  }
}

/**
 * 获取用于渲染头像的 HTML
 * @param {*} avatar base64 图片信息
 */
function getAvatarHtml(avatar) {
  let html = '';

  if (avatar) {
    html = `
                <div class="avatar">
                    <img src="${avatar}">
                </div>
            `;
  }

  return html;
}

/**
 * 获取聊天面板编辑器 HTML
 *
 * @param {*} toolsHtml 编辑器工具栏内按钮组 HTML
 *
 * 为按钮添加 editor__toolbar__item class 以保持样式的一致
 *
 * 示例：
 *    <a href="javascript:;" class="editor__toolbar__item btn--capture">
 *        <i class="iconfont icon-cut"></i>
 *    </a>
 */
function getChatEditorHtml(toolsHtml) {
  return `
        <div class="message__group__editor">
            <div class="editor__toolbar">
                ${toolsHtml}
            </div>
            <div class="message__group__textarea" contentEditable="true"></div>
        </div>
    `;
}

/**
 * 展示图片预览模态框
 * @param {*} base64Img
 */
function showImagePreviewModal(base64Img) {
  let modalHtml = `
        <div class="chat-modal chat-modal--image-preview">
            <div class="chat-modal__wrapper">
                <a href="javascript:;" class="chat-modal__close" style="
                    font-weight: normal;
                    font-size: 20px;
                ">×</a>
                <div class="chat-modal__bd">
                    <img src="${base64Img}">
                </div>
            </div>
        </div>
    `;

  $('body').append(modalHtml);
}

/**
 * 绑定聊天面板相关 GUI 事件
 */
function bindChatPanelGuiEvents() {
  const _events = [
    /**
     * 聊天内容中的图片被点击事件
     */
    function onChatTalkItemImageClick() {
      $(document).on('click', '.talk__item__bd img', function() {
        showImagePreviewModal($(this).attr('src'));
      });
    },

    function onChatModalCloseBtnClick() {
      $(document).on('click', '.chat-modal__close', function() {
        $(this)
          .closest('.chat-modal')
          .remove();
      });
    }
  ];

  // 遍历事件列表，执行事件绑定函数
  for (let func of _events) {
    func();
  }
}

module.exports = exports = {
  appendTalkItemToTalkPanel,
  bindChatPanelGuiEvents,
  getAvatarHtml,
  getChatEditorHtml,
  getChatTalkPanelHtml
};
