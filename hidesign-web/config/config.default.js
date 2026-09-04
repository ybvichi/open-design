/* eslint valid-jsdoc: "off" */

'use strict';

const path = require('path');

/**
 * @param {Egg.EggAppInfo} appInfo app info
 */
module.exports = appInfo => {
  /**
   * built-in config
   * @type {Egg.EggAppConfig}
   **/
  const config = exports = {
    security: {
      csrf: {
        enable: false,
        // useSession: false, // 默认为 false，当设置为 true 时，将把 csrf token 保存到 Session 中
        // sessionName: 'csrfToken', // Session 中的字段名，默认为 csrfToken
        // cookieName: 'csrfToken', // Cookie 中的字段名，默认为 csrfToken
        // headerName: 'x-csrf-token'
      },
    },
    cors: {
      origin: '*',
      allowMethods: 'GET,HEAD,PUT,POST,DELETE,PATCH',
      allowHeaders: 'Content-Type,Authorization,X-Requested-With',
      credentials: false,
    },
  };

  config.multipart = {
    // 只允许上传的图片格式
    whitelist: ['.png', '.jpg', '.jpeg'],
    // 文件允许大小
    fileSize: '50mb'
  }

  config.bodyParser = {
    jsonLimit: '50mb',
    formLimit: '50mb'
  }

  // 静态资源服务：关闭内存缓存与浏览器强缓存
  // 这样 public 目录下的文件更新后无需重启进程即可立即生效
  config.static = {
    prefix: '/public/',
    dir: path.join(appInfo.baseDir, 'app/public'),
    dynamic: true,     // 动态加载新增文件
    preload: false,    // 启动时不预加载
    buffer: false,     // 不把文件内容缓存进内存（否则需重启才刷新）
    cacheControl: 'no-cache, must-revalidate', // 浏览器每次必须回源验证，禁止直接用磁盘缓存
    maxAge: 0,
  };

  // use for cookie sign key, should change to your own and keep security
  config.keys = appInfo.name + '_1755242675950_7921';

  // 服务监听端口
  config.cluster = {
    listen: {
      port: 7002,
    },
  };

  // add your middleware config here
  config.middleware = [];

  // jwt 配置
  config.jwt = {
    secret: 'ybvichi', // 自定义加密字符串，secret 是在服务端的，不要泄露
    enable: true, // 默认是关闭的，如果开启，这会对所有请求进行自动校验
    //match: /^\/webapi\/v1\//, // 需要进行 JWT 校验的请求路径
   ignore: [
     /^\/hdw\//,
     /^\/$/,
   ],
    sign: {
      expiresIn: '24h', // 令牌过期时间
    },
    /**
     * username=yebo;secret=yapovichi => 713C9C311144AF22E6236205F7C451A9 
     * username=wengwenxiu;secret=yapovichi => 7BB7DAF93274E5A742F3B071794316CF
     * // 数字化部账号
     * username=zhangzefeng;secret=yapovichi => 0FA6C5F960CB1CA093590CEAC1347430 [章泽锋]
     * username=haoyili;secret=yapovichi => 3EC38E560C684E6EEC4CBCF4EB819E6B [郝以利]
     * // 云眸账号
     * username=hujincheng;secret=yapovichi => E3B7692B2421198A801ECA73837810F4 [胡金成]
     */
    // adminKeys: [
    //   '713C9C311144AF22E6236205F7C451A9', 
    //   '7BB7DAF93274E5A742F3B071794316CF'
    // ], // 从 token 中提取用户身份标识字段，默认从 payload 中提取
    // managerKeys: [
    //   '0FA6C5F960CB1CA093590CEAC1347430',
    //   '3EC38E560C684E6EEC4CBCF4EB819E6B',
    //   'E3B7692B2421198A801ECA73837810F4'
    // ]
  };

  // 数据库配置
  config.db = {
    host: '10.17.68.13',
    port: '5432',
    user: 'yapovichi',
    password: 'e6a22c32a1fb66309c8b9497952b4639',
    database: 'hidesign',
  };

  // ResourceHub blob 存储目录
  config.blobDir = path.join(appInfo.baseDir, 'data', 'blobs');

  // add your user config here
  const userConfig = {
    // myAppName: 'egg',
  };


  return {
    ...config,
    ...userConfig,
  };
};
