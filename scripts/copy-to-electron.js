const fs = require('fs');
const path = require('path');
const copydir = require('copy-dir');

copyToElectronFolder();

/**
 * 将项目打包后的目录拷贝到 Electron 发布目录
 */
function copyToElectronFolder() {
  const from = path.resolve(__dirname, '../www');
  const to = path.resolve(__dirname, '../electron/www');

  if (fs.existsSync(to)) {
    deleteFolderFiles(to);
  } else {
    fs.mkdirSync(to);
  }

  console.log(`
    [copy to electron folder]
      src: ${from}
      ==> to
      dest: ${to}
  `);

  copydir.sync(from, to);
}

/**
 * 删除目录内文件
 * @param {String} path
 */
function deleteFolderFiles(path) {
  if (fs.existsSync(path)) {
    fs.readdirSync(path).forEach(function(file, index) {
      var curPath = path + '/' + file;
      if (fs.lstatSync(curPath).isDirectory()) {
        // recurse
        deleteFolderRecursive(curPath);
      } else {
        // delete file
        fs.unlinkSync(curPath);
      }
    });
  }
}
