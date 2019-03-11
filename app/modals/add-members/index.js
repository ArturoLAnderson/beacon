const { BaseComponent } = require('common.ui-components/base');
const { Modal } = require('common.ui-components/modal');
const { Multiselect } = require('common.ui-components/multiselect/multiselect');
const { formatPublicKey } = require('common.utils');
const dbCore = require('../../db');
const {
  dbTools,
  broadcastGroupMemberStatus,
  renderGUIGroupMemberList
} = require('../../im-actions');

/**
 * 删除群成员模态框组件
 */
class AddMembersModal extends BaseComponent {
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
      <div class="app-multiselect-panel add-members-multiselect-panel">
      </div>
    `);

    const appUser = App.user;
    const contacts = dbCore.getUsers(App.db);

    for (let i = 0, len = contacts.length; i < len; i++) {
      let u = contacts[i];

      // 从列表中移除当前用户
      if (u['publicKey'] === appUser.publicKey) {
        contacts.splice(i, 1);
        break;
      }
    }

    // 创建多选面板
    const multiselect = new Multiselect({
      dataList: contacts,
      renderHTML(data) {
        return `
          <div
            class="message__group__item"
            data-user-pubkey="${data['publicKey']}"
            >
            <div class="info">
              <span class="nickname">${data['nickname']}</span>
            </div>
            <div class="meta">
              <small>${formatPublicKey(data['publicKey'])}</small>
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
      const selectedContacts = dataList.right;
      const memberStatus = [];

      const isGroupOwner = dbTools.isGroupOwner(
        App.db,
        groupId,
        App.user.publicKey
      );

      for (let u of selectedContacts) {
        if (isGroupOwner) {
          dbTools.addGroupMember(App.db, groupId, u);
        }

        memberStatus.push({
          nickname: u['nickname'],
          publicKey: u['publicKey'],
          isInGroup: true,
          isOnline: true
        });
      }

      // 如果当前用户不是群主，表示当前处于邀请群组成员环节
      const isInviteMode = !isGroupOwner;

      // 添加了新成员，需要初始化用于分发消息的群组分组
      App.fn.initGroup(config.group);

      if (isGroupOwner) {
        App.fn.broadcastAllMemberStatus(groupId);
      } else {
        // 广播添加群员消息
        App.fn.broadcastGroupMemberStatus(
          config.group,
          memberStatus,
          isInviteMode
        );
      }

      // 更新群组成员数量
      App.fn.updateGUIGroupMemberNum(groupId);

      // 重新渲染群成员列表
      App.fn.renderGUIGroupMemberList(groupId);

      this.modal.close();
    });

    multiselect.$on(multiselect.EVENT_CANCEL, () => {
      this.modal.close();
    });
  }
}

exports.AddMembersModal = AddMembersModal;
