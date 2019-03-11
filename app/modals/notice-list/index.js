require('./index.css');

const { BaseComponent } = require('common.ui-components/base');
const { Modal } = require('common.ui-components/modal');
const { formatPublicKey } = require('common.utils');

const { isUserExists, registerUser } = require('../../db');
const { renderGUIContacts } = require('../../im-group');

const baseNotice = require('../../notices');
const baseGroup = require('../../groups');
const noticedb = require('../../notices/db');

/**
 * 通知列表模态框组件
 */
class NoticeListModal extends BaseComponent {
  constructor() {
    super();
  }

  create() {
    const $wrapper = this.createRootElem(`
      <div class="notice-list-wrapper">
        <div class="notice-list">
          <h4 class="notice-list-hd">Notification Messages</h4>
          <div class="notice-list-bd">
            <small style="color: gray;">None</small>
          </div>
        </div>
      </div>
    `);
    const $noticeList = $wrapper.find('.notice-list-bd');
    const notices = noticedb.getNotices(App.db);

    if (notices.length > 0) {
      $noticeList.empty();

      for (let notice of notices) {
        const item = new NoticeItem({
          notice: notice
        });

        item.render($noticeList);
      }
    }

    // 创建弹出层
    const modal = new Modal({
      showBackdrop: true,
      body: $wrapper
    });
    this.modal = modal;
    modal.render('body');
  }

  onCreated() {
    this._bindEvent_showNoticeListModal();
  }

  /**
   * 绑定事件，阻止点击事件冒泡
   */
  _bindEvent_showNoticeListModal() {
    this.$elem.children('.notice-list').on('click', function(event) {
      event.stopPropagation();
    });
  }
}

exports.NoticeListModal = NoticeListModal;

/**
 * 通知列表项组件
 */
class NoticeItem extends BaseComponent {
  /**
   * @example
   * const config = {
   *   notice: {...} // 通知对象
   * };
   * @param {Object} config
   */
  constructor(config) {
    super(config);
  }

  create() {
    const notice = this.config.notice;

    this.createRootElem(`
      <div class="notice-item" data-notice-id="${notice.id}">
      </div>
    `);

    this.renderInnerHTML();
  }

  renderInnerHTML() {
    const notice = this.config.notice;
    let _payload = notice.payload;
    let innerHTML;

    switch (notice.type) {
      // 新联系人通知
      case baseNotice.NOTICE_TYPE_NEW_CONTACT: {
        let nickname, publicKey;
        const appUser = App.user;
        let headerHTML, controlHTML;

        if (appUser.publicKey === _payload.sender.publicKey) {
          nickname = _payload.receiver.nickname;
          publicKey = _payload.receiver.publicKey;

          headerHTML = 'Add Contact';
          controlHTML = `
            <small>${notice.status}</small>
          `;
        } else {
          nickname = _payload.sender.nickname;
          publicKey = _payload.sender.publicKey;

          headerHTML = 'New Contact Ask';

          if (notice.status === 'waiting') {
            controlHTML = `
              <select>
                <option value="waiting" >waiting</option>
                <option value="allow" >allow</option>
                <option value="reject" >reject</option>
              </select>
            `;
          } else {
            controlHTML = `
              <small>${notice.status}</small>
            `;
          }
        }

        innerHTML = `
          <div class="notice-item__inner">
            <div class="notice-item__hd">${headerHTML}</div>
            <div class="notice-item__bd">
              <div class="notice-item__payload">
                <div class="user">${nickname}</div>
                <div class="publickey">
                  <small>${formatPublicKey(publicKey)}</small>
                </div>
              </div>
              <div class="notice-item__control">
                ${controlHTML}
              </div>
            </div>
          </div>
        `;
        break;
      }

      // 新成员通知
      case baseNotice.NOTICE_TYPE_NEW_GROUP_MEMBER: {
        let controlHTML;

        if (notice.status === 'waiting') {
          controlHTML = `
            <select>
              <option value="waiting" >waiting</option>
              <option value="allow" >allow</option>
              <option value="reject" >reject</option>
            </select>
          `;
        } else {
          controlHTML = `
            <small>${notice.status}</small>
          `;
        }

        innerHTML = `
          <div class="notice-item__inner">
            <div class="notice-item__hd">New Group Member Ask</div>
            <div class="notice-item__bd">
              <div class="notice-item__payload">
                <div>Group: ${_payload.group.title}</div>
                <div class="user">
                  ${_payload.inviter.nickname}
                  (<small class="meta">
                    ${formatPublicKey(_payload.inviter.publicKey)}
                  </small>)
                </div>
                <div><small>invite</small></div>
                <div class="user">
                  ${_payload.invitee.nickname}
                  (<small class="meta">
                    ${formatPublicKey(_payload.invitee.publicKey)}
                  </small>)
                </div>
              </div>
              <div class="notice-item__control">
                ${controlHTML}
              </div>
            </div>
          </div>
        `;
        break;
      }
    }

    this.$elem.empty().append(innerHTML);
  }

  onCreated() {
    this._bindEvent_onStatusSelectChanged();
  }

  _bindEvent_onStatusSelectChanged() {
    const _this = this;
    const $select = this.$elem.find('.notice-item__control select');

    // 存在 select 就为其绑定 onchange 事件
    if ($select.length > 0) {
      $select.on('change', function() {
        const notice = _this.config.notice;
        const status = $(this).val();

        switch (notice.type) {
          case baseNotice.NOTICE_TYPE_NEW_CONTACT: {
            __addContactNoticeCallback(notice, status);
            break;
          }

          case baseNotice.NOTICE_TYPE_NEW_GROUP_MEMBER: {
            __addGroupMemberNoticeCallback(notice, status);
            break;
          }
        }
      });
    }

    /**
     * 添加联系人消息回调
     * @param {Object} notice 通知对象
     * @param {String} status 通知对象的最新状态
     */
    function __addContactNoticeCallback(notice, status) {
      const sender = notice.payload.sender;

      // 更新 notice 对象中的 receiver 信息
      notice.payload.receiver.nickname = App.user.nickname;

      notice.status = status;
      noticedb.updateNoticeStatus(App.db, notice.key, status);
      _this.renderInnerHTML();

      baseNotice.sendAddContactResponse(sender.publicKey, notice);

      if (status === 'allow') {
        // 如果用户不存在，添加到数据库并请求用户信息
        if (!isUserExists(App.db, sender.publicKey)) {
          const isFans = 1;

          registerUser(
            App.db,
            sender.publicKey,
            sender.nickname,
            App.defaultAvatar,
            isFans,
            status
          );
        }

        renderGUIContacts();
      }
    }

    /**
     * 添加群成员消息回调
     * @param {Object} notice 通知对象
     * @param {String} status 通知对象的最新状态
     */
    function __addGroupMemberNoticeCallback(notice, status) {
      const fn = App.fn;
      notice.status = status;

      noticedb.updateNoticeStatus(App.db, notice.key, status);

      _this.renderInnerHTML();
      if (status === 'allow') {
        const group = baseGroup.getGroupFromCache(notice.payload.group.key);

        fn.dbTools.addGroupMember(App.db, group.id, notice.payload.invitee);
        fn.initGroupMembers(group);
        fn.updateGUIGroupMemberNum(group.id);
        fn.renderGUIGroupMemberList(group.id);
        fn.broadcastAllMemberStatus(group.id);
      }
    }
  }
}
