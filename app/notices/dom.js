/**
 * 设置通知按钮小红点状态
 * @param {String} status "show", "hide"，表示是否有新的通知信息
 */
function setNoticeBadge(status = 'show') {
  const $badge = $('#btn--show-notice-modal').find('.badge-dot');

  if (status === 'show') {
    $badge.removeClass('hide');
  } else {
    $badge.addClass('hide');
  }
}

exports.setNoticeBadge = setNoticeBadge;
