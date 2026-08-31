let knex;

function createKnex(config = {}) {
  if (!knex) {
    knex = require('knex')({
      client: 'pg',
      connection: config,
    });
    console.log('KNEX 初始化完成');
  }
  return knex;
}

module.exports = {
  createKnex,
};
