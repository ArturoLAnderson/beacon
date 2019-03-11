window.$ = require('jquery');

/**
 * tabs
 */
$(function() {
  const ACTIVE = 'active';
  const SHOW = 'show';

  $(document).on('click', '.tab__nav__item', function() {
    const $btn = $(this);
    const targetId = $btn.data('target');

    $btn
      .addClass(ACTIVE)
      .siblings('.' + ACTIVE)
      .removeClass(ACTIVE);
    $(targetId)
      .addClass(SHOW)
      .siblings('.' + SHOW)
      .removeClass(SHOW);
  });
});

$(function() {
  const hideClass = 'v-hide';
  const closeEvent = 'modal.close';

  $(document).on(closeEvent, '.modal-mask', function() {
    $(this).addClass(hideClass);
  });

  $(document).on('click', '.modal__close', function() {
    $(this).trigger(closeEvent);
  });
});

// function to encode file data to base64 encoded string
function base64Encode(file) {
  // read binary data
  var bitmap = fs.readFileSync(file);
  // convert binary data to base64 encoded string
  return new Buffer(bitmap).toString('base64');
}

// function to create file from base64 encoded string
function base64Decode(base64str, file) {
  // create buffer object from base64 encoded string, it is important to tell the constructor that the string is base64 encoded
  var bitmap = new Buffer(base64str, 'base64');
  // write buffer to file
  fs.writeFileSync(file, bitmap);
  console.log('******** File created from base64 encoded string ********');
}

exports.base64 = {
  encode: base64Encode,
  decode: base64Decode
};
