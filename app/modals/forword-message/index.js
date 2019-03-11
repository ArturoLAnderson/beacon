const { BaseComponent } = require('common.ui-components/base');
const { Modal } = require('common.ui-components/modal');
const { Multiselect } = require('common.ui-components/multiselect/multiselect');
const { chatroomConstants } = require('common.ui-components/chatroom/utils');

const { dbTools } = require('../../im-actions');

/**
 * 转发消息模态框组件
 */
class ForwordMessageModal extends BaseComponent {
  /**
   * @example
   * const config = {
   *   dataList: [...], // 渲染列表项的数据
   *   renderHtml(data) { return `<div>${data}</div>`; } // 渲染列表项 HTML 的回调函数
   * };
   * @param {Object} config
   */
  constructor(config) {
    super(config);
  }

  create() {
    const $elem = this.createRootElem(`
      <div class="app-multiselect-panel forword-multiselect-panel">
      </div>
    `);

    const groups = dbTools.getGroups(App.db);

    // 创建多选面板
    const multiselect = new Multiselect({
      dataList: groups,
      renderHTML(data) {
        return `
          <div
            class="message__group__item"
            data-group-id="${data['id']}"
            data-group-key="${data['key']}">
            <div class="info">
              <span class="nickname">${data['title']}</span>
            </div>
            <div class="type"><small>${
              data['type'] === 'group' ? 'group' : 'contact'
            }</small></div>
          </div>
        `;
      }
    });
    this.multiselect = multiselect;
    multiselect.render($elem);

    // 创建弹出层
    const modal = new Modal({
      showBackdrop: true,
      body: $elem
    });
    this.modal = modal;
    modal.render('body');
  }

  onCreated() {
    this._bindEvent_onSelected();
  }

  /**
   * 绑定事件，选择完成
   */
  _bindEvent_onSelected() {
    const multiselect = this.multiselect;
    const _consts = chatroomConstants;

    multiselect.$on(multiselect.EVENT_OK, dataList => {
      const selectedGroups = dataList.right;

      for (let group of selectedGroups) {
        let groupConf = App.groupIdMap[group['id']];
        let chatroomPanel = groupConf.chatroomPanel;

        if (chatroomPanel) {
          // 发送消息到群组类型聊天室
          chatroomPanel.trigger(
            _consts.EVENT_SEND_MESSAGE,
            this.config.message
          );
        }
      }

      this.modal.close();
    });

    multiselect.$on(multiselect.EVENT_CANCEL, () => {
      this.modal.close();
    });
  }
}

exports.ForwordMessageModal = ForwordMessageModal;
