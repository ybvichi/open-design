'use strict';

const { createKnex } = require('../../utils/knex.js');

const Controller = require('egg').Controller;

class FolderController extends Controller {
  getKnex() {
    if (!this._knex) {
      this._knex = createKnex(this.app.config.db);
    }
    return this._knex;
  }

  // 权限校验:操作者必须在指定团队中
  async _checkOperator(memberId, workspaceId, allowedRoles) {
    if (!memberId) {
      return { error: '缺少必要参数 operator_member_id' };
    }
    const k = this.getKnex();
    const member = await k('workspace_members')
      .where({ workspace_member_id: memberId, workspace_id: workspaceId })
      .first();
    if (!member) {
      return { error: '操作者不在该团队中(无权限)' };
    }
    if (allowedRoles && !allowedRoles.includes(member.role)) {
      return { error: '权限不足' };
    }
    return { member };
  }

  // 创建文件夹
  // body: { workspace_id, folder_name, folder_pid?, operator_member_id? }
  async add() {
    const { ctx } = this;
    const {
      workspace_id: workspaceId,
      folder_name: folderName,
      folder_pid: folderPid = null,
      operator_member_id: operatorId,
    } = ctx.request.body;

    if (!workspaceId || !folderName) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 workspace_id 或 folder_name' };
      return;
    }

    try {
      const k = this.getKnex();
      // 校验团队存在
      const ws = await k('workspaces').where({ workspace_id: workspaceId }).first();
      if (!ws) {
        ctx.body = { code: -1, msg: 'FAIL', error: '团队不存在' };
        return;
      }
      // 权限校验(可选)
      if (operatorId) {
        const check = await this._checkOperator(operatorId, workspaceId, ['owner', 'admin', 'member']);
        if (check.error) {
          ctx.body = { code: -1, msg: 'FAIL', error: check.error };
          return;
        }
      }
      // 若指定了父文件夹,校验其存在且属于同一团队
      if (folderPid) {
        const parent = await k('folders').where({ folder_id: folderPid, workspace_id: workspaceId }).first();
        if (!parent) {
          ctx.body = { code: -1, msg: 'FAIL', error: '父文件夹不存在或不属于该团队' };
          return;
        }
      }

      const now = new Date();
      const [inserted] = await k('folders').insert({
        folder_pid: folderPid,
        workspace_id: workspaceId,
        folder_name: folderName,
        created_at: now,
      }, ['folder_id', 'folder_pid', 'workspace_id', 'folder_name']);

      ctx.body = {
        code: 0,
        msg: 'SUCCESS',
        data: inserted,
      };
    } catch (err) {
      ctx.logger.error('Folder add error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // 删除文件夹(连同子文件夹及文件夹内项目关联一并清理,由 ON DELETE CASCADE 完成)
  // params: folder_id; query: operator_member_id?
  async del() {
    const { ctx } = this;
    const { folder_id: folderId } = ctx.params;
    const { operator_member_id: operatorId } = ctx.query;

    if (!folderId) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 folder_id' };
      return;
    }

    try {
      const k = this.getKnex();
      const folder = await k('folders').where({ folder_id: folderId }).first();
      if (!folder) {
        ctx.body = { code: -1, msg: 'FAIL', error: '文件夹不存在' };
        return;
      }
      // 权限校验(可选)
      if (operatorId) {
        const check = await this._checkOperator(operatorId, folder.workspace_id, ['owner', 'admin']);
        if (check.error) {
          ctx.body = { code: -1, msg: 'FAIL', error: check.error };
          return;
        }
      }

      await k('folders').where({ folder_id: folderId }).del();
      ctx.body = { code: 0, msg: 'SUCCESS', data: { deleted: true } };
    } catch (err) {
      ctx.logger.error('Folder delete error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // 修改文件夹名称
  // body: { folder_id, folder_name, operator_member_id? }
  async rename() {
    const { ctx } = this;
    const { folder_id: folderId, folder_name: folderName, operator_member_id: operatorId } = ctx.request.body;

    if (!folderId || !folderName) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 folder_id 或 folder_name' };
      return;
    }

    try {
      const k = this.getKnex();
      const folder = await k('folders').where({ folder_id: folderId }).first();
      if (!folder) {
        ctx.body = { code: -1, msg: 'FAIL', error: '文件夹不存在' };
        return;
      }
      if (operatorId) {
        const check = await this._checkOperator(operatorId, folder.workspace_id, ['owner', 'admin']);
        if (check.error) {
          ctx.body = { code: -1, msg: 'FAIL', error: check.error };
          return;
        }
      }

      await k('folders').where({ folder_id: folderId }).update({ folder_name: folderName });
      ctx.body = { code: 0, msg: 'SUCCESS', data: { renamed: true } };
    } catch (err) {
      ctx.logger.error('Folder rename error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // 查询团队下的文件夹列表(树形结构)
  // query: workspace_id
  async list() {
    const { ctx } = this;
    const { workspace_id: workspaceId } = ctx.query;

    if (!workspaceId) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 workspace_id' };
      return;
    }

    try {
      const k = this.getKnex();
      const query = k('folders')
        .where({ workspace_id: workspaceId })
        .select(
          'folder_id', 'folder_pid', 'workspace_id', 'folder_name', 'created_at',
          k.raw('(SELECT COUNT(*) FROM folders sub WHERE sub.folder_pid = folders.folder_id) AS subfolder_count'),
          k.raw('(SELECT COUNT(*) FROM folder_projects fp WHERE fp.folder_id = folders.folder_id) AS project_count'),
          k.raw("(SELECT json_agg(sub.folder_name) FROM (SELECT folder_name FROM folders AS inner_f WHERE inner_f.folder_pid = folders.folder_id ORDER BY inner_f.created_at ASC LIMIT 4) sub) AS subfolder_preview"),
        )
        .orderBy('created_at', 'asc');

      // folder_pid 为空值（null/undefined/空字符串）时查根级文件夹，
      // 否则查指定父文件夹下的子文件夹
      const { folder_pid: folderPid } = ctx.query;
      if (!folderPid) {
        query.whereNull('folder_pid');
      } else {
        query.where({ folder_pid: folderPid });
      }

      const folders = await query;

      ctx.body = { code: 0, msg: 'SUCCESS', data: { folders } };
    } catch (err) {
      ctx.logger.error('Folder list error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }


  // 查询单个文件夹详情(含 folder_pid, 用于面包屑路径)
  // params: folder_id
  async detail() {
    const { ctx } = this;
    const { folder_id: folderId } = ctx.query;

    if (!folderId) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 folder_id' };
      return;
    }

    try {
      const k = this.getKnex();
      const folder = await k('folders')
        .where({ folder_id: folderId })
        .select('folder_id', 'folder_pid', 'workspace_id', 'folder_name', 'created_at')
        .first();

      if (!folder) {
        ctx.body = { code: -1, msg: 'FAIL', error: '文件夹不存在' };
        return;
      }

      ctx.body = { code: 0, msg: 'SUCCESS', data: folder };
    } catch (err) {
      ctx.logger.error('Folder detail error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // 添加项目到文件夹
  // body: { folder_id, project_id, workspace_id, operator_member_id? }
  async addProject() {
    const { ctx } = this;
    const {
      folder_id: folderId,
      project_id: projectId,
      workspace_id: workspaceId,
      operator_member_id: operatorId,
    } = ctx.request.body;

    if (!folderId || !projectId || !workspaceId) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 folder_id, project_id 或 workspace_id' };
      return;
    }

    try {
      const k = this.getKnex();
      // 校验文件夹存在且属于该团队
      const folder = await k('folders').where({ folder_id: folderId, workspace_id: workspaceId }).first();
      if (!folder) {
        ctx.body = { code: -1, msg: 'FAIL', error: '文件夹不存在或不属于该团队' };
        return;
      }
      if (operatorId) {
        const check = await this._checkOperator(operatorId, workspaceId, ['owner', 'admin', 'member']);
        if (check.error) {
          ctx.body = { code: -1, msg: 'FAIL', error: check.error };
          return;
        }
      }

      const now = new Date();
      await k('folder_projects').insert({
        folder_id: folderId,
        project_id: projectId,
        workspace_id: workspaceId,
        created_at: now,
      });

      ctx.body = { code: 0, msg: 'SUCCESS', data: { folder_id: folderId, project_id: projectId } };
    } catch (err) {
      // 主键冲突 = 项目已在该文件夹中
      if (err.code === '23505') {
        ctx.body = { code: -1, msg: 'FAIL', error: '该项目已在该文件夹中' };
        return;
      }
      ctx.logger.error('Folder addProject error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // 从文件夹移除项目
  // body: { folder_id, project_id, operator_member_id? }
  async removeProject() {
    const { ctx } = this;
    const { folder_id: folderId, project_id: projectId, operator_member_id: operatorId } = ctx.request.body;

    if (!folderId || !projectId) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 folder_id 或 project_id' };
      return;
    }

    try {
      const k = this.getKnex();
      const link = await k('folder_projects').where({ folder_id: folderId, project_id: projectId }).first();
      if (!link) {
        ctx.body = { code: -1, msg: 'FAIL', error: '该项目不在该文件夹中' };
        return;
      }
      if (operatorId) {
        const check = await this._checkOperator(operatorId, link.workspace_id, ['owner', 'admin']);
        if (check.error) {
          ctx.body = { code: -1, msg: 'FAIL', error: check.error };
          return;
        }
      }

      await k('folder_projects').where({ folder_id: folderId, project_id: projectId }).del();
      ctx.body = { code: 0, msg: 'SUCCESS', data: { removed: true } };
    } catch (err) {
      ctx.logger.error('Folder removeProject error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // 查询文件夹内的项目列表
  // query: folder_id
  async listProjects() {
    const { ctx } = this;
    const { folder_id: folderId } = ctx.query;

    if (!folderId) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 folder_id' };
      return;
    }

    try {
      const k = this.getKnex();
      const projects = await k('folder_projects')
        .where({ folder_id: folderId })
        .select('folder_id', 'project_id', 'workspace_id', 'created_at')
        .orderBy('created_at', 'asc');

      ctx.body = { code: 0, msg: 'SUCCESS', data: { projects } };
    } catch (err) {
      ctx.logger.error('Folder listProjects error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // 移动项目到另一个文件夹
  // body: { folder_id(目标), project_id, workspace_id, from_folder_id?, operator_member_id? }
  async moveProject() {
    const { ctx } = this;
    const {
      folder_id: folderId,
      project_id: projectId,
      workspace_id: workspaceId,
      from_folder_id: fromFolderId,
      operator_member_id: operatorId,
    } = ctx.request.body;

    if (!folderId || !projectId || !workspaceId) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 folder_id, project_id 或 workspace_id' };
      return;
    }

    try {
      const k = this.getKnex();
      // 校验目标文件夹存在且属于该团队
      const folder = await k('folders').where({ folder_id: folderId, workspace_id: workspaceId }).first();
      if (!folder) {
        ctx.body = { code: -1, msg: 'FAIL', error: '目标文件夹不存在或不属于该团队' };
        return;
      }
      if (operatorId) {
        const check = await this._checkOperator(operatorId, workspaceId, ['owner', 'admin', 'member']);
        if (check.error) {
          ctx.body = { code: -1, msg: 'FAIL', error: check.error };
          return;
        }
      }

      const now = new Date();
      await k.transaction(async trx => {
        // 从源文件夹移除(若指定了 from_folder_id)
        if (fromFolderId) {
          await trx('folder_projects')
            .where({ folder_id: fromFolderId, project_id: projectId })
            .del();
        } else {
          // 未指定源文件夹,从该团队下任意文件夹移除
          await trx('folder_projects')
            .where({ project_id: projectId, workspace_id: workspaceId })
            .del();
        }
        // 加入目标文件夹
        await trx('folder_projects').insert({
          folder_id: folderId,
          project_id: projectId,
          workspace_id: workspaceId,
          created_at: now,
        });
      });

      ctx.body = { code: 0, msg: 'SUCCESS', data: { folder_id: folderId, project_id: projectId } };
    } catch (err) {
      if (err.code === '23505') {
        ctx.body = { code: -1, msg: 'FAIL', error: '该项目已在目标文件夹中' };
        return;
      }
      ctx.logger.error('Folder moveProject error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }
}

module.exports = FolderController;
