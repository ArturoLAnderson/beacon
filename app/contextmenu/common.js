/**
 * 获取默认菜单模板
 * @param {Object} props
 * @param {Object} editFlags
 */
function getDefaultMenuTemplate(props, editFlags) {
  return [
    {
      accelerator: 'CmdOrCtrl+X',
      label: 'Cut',
      role: can('Cut') ? 'cut' : '',
      enabled: can('Cut'),
      visible: props.isEditable
    },
    {
      accelerator: 'CmdOrCtrl+C',
      label: 'Copy',
      role: can('Copy') ? 'copy' : '',
      enabled: can('Copy'),
      visible: props.isEditable || hasText
    },
    {
      accelerator: 'CmdOrCtrl+V',
      label: 'Paste',
      role: editFlags.canPaste ? 'paste' : '',
      enabled: editFlags.canPaste,
      visible: props.isEditable
    },
    {
      accelerator: 'CmdOrCtrl+A',
      label: 'Select All',
      role: hasText ? 'selectall' : '',
      enabled: hasText
    }
  ];
}

exports.getDefaultMenuTemplate = getDefaultMenuTemplate;

/**
 * 右键菜单事件
 */
exports.CONTEXT_MENU_CHANNEL = 'beacon:contextmenu';
/**
 * 关闭右键菜单事件
 */
exports.CONTEXT_MENU_CLOSE_CHANNEL = 'beacon:onCloseContextMenu';
