let knex;

function createKnex(config = {}) {
  if (!knex) {
    knex = require('knex')({
      client: 'pg',
      connection: config,
      // 限制连接池上限,避免多 worker 进程叠加后打满 PostgreSQL max_connections(53300)。
      // egg-scripts 默认按 CPU 核数启动 worker,每个 worker 各持一份单例 knex,
      // 故 max=5 × N 核仍有余量留给 daemon 及运维会话。min=0 空闲时不占连接。
      pool: {
        min: 0,
        max: 5,
        idleTimeoutMillis: 30000,
        propagateCreateError: false,
      },
    });
    console.log('KNEX 初始化完成');
  }
  return knex;
}

module.exports = {
  createKnex,
};
