const schemas = {
  /**
   * status 联系人的加入状态，值为 waiting、allow、reject
   */
  User: `
    CREATE TABLE IF NOT EXISTS "users" (
        "id" integer PRIMARY KEY AUTOINCREMENT,
        "avatar" text NOT NULL,
        "nickname" text NOT NULL,
        "publicKey" text NOT NULL,
        "online" boolean NOT NULL,
        "is_fans" boolean NOT NULL default(0),
        "status" text NOT NULL default('waiting'),
        unique(publicKey)
    );

    CREATE INDEX IF NOT EXISTS idx_users_publicKey ON "users" ("publicKey");
  `,
  File: `
    CREATE TABLE IF NOT EXISTS "files" (
        "id" integer PRIMARY KEY AUTOINCREMENT,
        "hash" text NOT NULL,
        unique(hash)
    );

    CREATE INDEX IF NOT EXISTS idx_files_hash ON "files" ("hash");
  `,
  NodeFileRelation: `
    CREATE TABLE IF NOT EXISTS "user_file_relations" (
        "id" integer PRIMARY KEY AUTOINCREMENT,
        "user_id" integer NOT NULL,
        "file_id" integer NOT NULL,
        "file_name" text NOT NULL,
        "file_path" text,
        "file_size" integer NOT NULL,
        unique (user_id, file_id)
    );

    CREATE INDEX IF NOT EXISTS idx_user_file_relations_user_id ON "user_file_relations" ("user_id");
    CREATE INDEX IF NOT EXISTS idx_user_file_relations_file_id ON "user_file_relations" ("file_id");
    CREATE INDEX IF NOT EXISTS idx_user_file_relations_file_name ON "user_file_relations" ("file_name");
  `,
  //status: fail属于未完成状态，文件需要带临时文件扩展名
  DownloadFile: `
    CREATE TABLE IF NOT EXISTS "download_files" (
        "id" integer PRIMARY KEY AUTOINCREMENT,
        "file_name" text NOT NULL,
        "file_hash" text NOT NULL,
        "file_size" integer NOT NULL,
        "user_nickname" text NOT NULL,
        "user_publicKey" text NOT NULL,
        "save_path" text NOT NULL,
        "save_offset" bigint NOT NULL default(0),
        "request_num" integer NOT NULL default(0),
        "last_request_time" bigint,
        "is_completed" boolean default(0),
        "status" TEXT NOT NULL default('processing')
    );

    CREATE INDEX IF NOT EXISTS idx_download_files_file_hash ON "download_files" ("file_hash");
    CREATE INDEX IF NOT EXISTS idx_download_files_request_num ON "download_files" ("request_num");
    CREATE INDEX IF NOT EXISTS idx_download_files_status ON "download_files" ("status");
  `,
  IMGroup: `
    CREATE TABLE IF NOT EXISTS "im_groups" (
        "id" integer PRIMARY KEY AUTOINCREMENT,
        "key" text NOT NULL,
        "title" text NOT NULL,
        "type" text NOT NULL default('normal'),
        "member_num" integer NOT NULL default(0),
        "last_talk_time" usigned big int default(0),
        unique (key)
    );

    CREATE INDEX IF NOT EXISTS idx_im_groups_key ON "im_groups" ("key");
  `,
  IMGroupUserRelation: `
    CREATE TABLE IF NOT EXISTS "im_group_user_relations" (
        "id" integer PRIMARY KEY AUTOINCREMENT,
        "group_id" integer NOT NULL,
        "user_nickname" text NOT NULL,
        "user_publicKey" text NOT NULL,
        "online" boolean NOT NULL default(1),
        unique (group_id, user_publicKey)
    );

    CREATE INDEX IF NOT EXISTS idx_im_group_user_relations_group_id ON "im_group_user_relations" ("group_id");
    CREATE INDEX IF NOT EXISTS idx_im_group_user_relations_user_publicKey ON "im_group_user_relations" ("user_publicKey");
    CREATE INDEX IF NOT EXISTS idx_im_group_user_relations_online ON "im_group_user_relations" ("online");
  `,
  /* 通知表存储所有的通知信息，如新的添加联系人请求，群成员加入申请等等
   * status 通知的状态，值为 waiting、allow、reject、done
   */
  Notices: `
    CREATE TABLE IF NOT EXISTS "notices" (
        "id" integer PRIMARY KEY AUTOINCREMENT,
        "key" text NOT NULL,
        "type" text,
        "payload" text,
        "status" text NOT NULL default('waiting'),
        "create_time" bigint NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notices_key ON "notices" ("key");
  `,
  /* 消息表存储所有的接收到的消息 */
  IMMessages: `
    CREATE TABLE IF NOT EXISTS "im_messages" (
        "id" integer PRIMARY KEY AUTOINCREMENT,
        "cmd_type" CHAR(32) NOT NULL,
        "group_key" TEXT NOT NULL,
        "key" BIGINT NOT NULL,
        "sender" CHAR(70) NOT NULL,
        "create_time" BIGINT NOT NULL,
        "type" CHAR(8) NOT NULL,
        "file_name" CHAR(32),
        "ext_name" CHAR(10),
        "payload" TEXT,
        "data_id" INT,
        "parents" TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_im_messages_group_key ON "im_messages" ("group_key");
    CREATE INDEX IF NOT EXISTS idx_im_messages_key ON "im_messages" ("key");
  `,
  /* 消息数据表存储所有的接收到的消息中的数据 */
  IMMessageData: `
    CREATE TABLE IF NOT EXISTS "im_message_data" (
        "id" integer PRIMARY KEY AUTOINCREMENT,
        "md5sum" CHAR(32) NOT NULL,
        "length" INT NOT NULL,
        "size" INT NOT NULL,
        "content" TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_im_message_data_md5sum ON "im_message_data" ("md5sum");
    `,

  IMMessageGraphSinks: `
    CREATE TABLE IF NOT EXISTS "im_message_graph_sinks" (
        "group_key" TEXT NOT NULL,
        "sinks" BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_im_message_graph_sinks_group_key ON "im_message_graph_sinks" ("group_key");
  `
};

module.exports = exports = schemas;
