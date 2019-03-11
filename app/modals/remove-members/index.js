const { BaseComponent } = require('common.ui-components/base');
const { Modal } = require('common.ui-components/modal');
const { Multiselect } = require('common.ui-components/multiselect/multiselect');
const { formatPublicKey } = require('common.utils');

const {
  dbTools,
  broadcastGroupMemberStatus,
  renderGUIGroupMemberList
} = require('../../im-actions');

/**
 * 删除群成员模态框组件
 */
class RemoveMembersModal extends BaseComponent {
  /**
   * @example
   * const config = {
   *   group: {...} // 群组对象
   * };
   * @param {Object} config
   */
  constructor(config) {
    super(config);
  }

  create() {
    const config = this.config;
    const $elem = this.createRootElem(`
      <div class="app-multiselect-panel remove-members-multiselect-panel">
      </div>
    `);

    const appUser = App.user;
    const members = dbTools.getMembers(App.db, config.group.id);

    for (let i = 0, len = members.length; i < len; i++) {
      let m = members[i];

      // 从列表中移除当前用户
      if (m['user_publicKey'] === appUser.publicKey) {
        members.splice(i, 1);
        break;
      }
    }

    // 创建多选面板
    const multiselect = new Multiselect({
      dataList: members,
      renderHTML(data) {
        return `
          <div
            class="message__group__item"
            data-user-pubkey="${data['user_publicKey']}"
            >
            <div class="info">
              <span class="nickname">${data['user_nickname']}</span>
            </div>
            <div class="meta">
              <small>${formatPublicKey(data['user_publicKey'])}</small>
            </div>
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
    const config = this.config;
    const groupId = config.group.id;
    const multiselect = this.multiselect;

    multiselect.$on(multiselect.EVENT_OK, dataList => {
      const selectedMembers = dataList.right;
      const memberStatus = [];

      for (let m of selectedMembers) {
        memberStatus.push({
          nickname: m['user_nickname'],
          publicKey: m['user_publicKey'],
          isInGroup: false,
          isOnline: false
        });

        dbTools.removeGroupMember(App.db, groupId, m['user_publicKey']);
      }

      // 广播群组成员状态
      broadcastGroupMemberStatus(config.group, memberStatus);
      renderGUIGroupMemberList(groupId);

      this.modal.close();
    });

    multiselect.$on(multiselect.EVENT_CANCEL, () => {
      this.modal.close();
    });
  }
}

exports.RemoveMembersModal = RemoveMembersModal;
