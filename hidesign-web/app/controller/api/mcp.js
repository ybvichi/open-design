'use strict';

const { createKnex } = require('../../utils/knex.js');
const crypto = require('node:crypto');

const Controller = require('egg').Controller;

// MCP template catalog stored as HDW resources (kind = 'mcp').
//
// Unlike skill/plugin resources that use the manifest+blob protocol,
// MCP templates are pure JSON — the entire template lives in the
// resource's `metadata` JSONB column. This controller provides direct
// CRUD without the two-phase blob upload dance.
//
// Response format: { code, msg, data } — same envelope as team/folder
// controllers, consumed by the daemon's hdw proxy client.

const KIND = 'mcp';

class McpController extends Controller {
  getKnex() {
    if (!this._knex) {
      this._knex = createKnex(this.app.config.db);
    }
    return this._knex;
  }

  // ---- List: GET /hdw/api/mcp?workspace_id=...&owner_member_id=... ----
  async list() {
    const { ctx } = this;
    const workspaceId = ctx.query.workspace_id || ctx.request.headers['x-hdw-workspace-id'];
    const ownerMemberId = ctx.query.owner_member_id;

    if (!workspaceId) {
      ctx.body = { code: 0, msg: 'ok', data: { templates: [] } };
      return;
    }

    try {
      const k = this.getKnex();
      let q = k('resources')
        .where({ kind: KIND, workspace_id: workspaceId })
        .whereNull('deleted_at')
        .select('id', 'owner_member_id', 'metadata', 'created_at', 'updated_at')
        .orderBy('updated_at', 'desc');

      if (ownerMemberId) {
        q = q.where('owner_member_id', ownerMemberId);
      }

      const rows = await q;
      const templates = rows.map(row => {
        const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {});
        return {
          resourceId: row.id,
          ownerMemberId: row.owner_member_id,
          ...meta,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      });

      ctx.body = { code: 0, msg: 'ok', data: { templates } };
    } catch (err) {
      ctx.logger.error('[hdw] mcp list error:', err);
      ctx.body = { code: -1, msg: 'internal error', error: err.message };
    }
  }

  // ---- Check: GET /hdw/api/mcp/check?workspace_id=...&label=... ----
  // Returns { exists: boolean } so the web UI can reject duplicates
  // before calling create.
  async check() {
    const { ctx } = this;
    const workspaceId = ctx.query.workspace_id || ctx.request.headers['x-hdw-workspace-id'];
    const label = (ctx.query.label || '').trim();

    if (!workspaceId || !label) {
      ctx.body = { code: -1, msg: 'workspace_id and label are required' };
      return;
    }

    try {
      const k = this.getKnex();
      const rows = await k('resources')
        .where({ kind: KIND, workspace_id: workspaceId })
        .whereNull('deleted_at')
        .select('metadata');

      const exists = rows.some(row => {
        const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {});
        return (meta.label || '').trim().toLowerCase() === label.toLowerCase();
      });

      ctx.body = { code: 0, msg: 'ok', data: { exists } };
    } catch (err) {
      ctx.logger.error('[hdw] mcp check error:', err);
      ctx.body = { code: -1, msg: 'internal error', error: err.message };
    }
  }

  // ---- Create: POST /hdw/api/mcp ----
  async create() {
    const { ctx } = this;
    const body = ctx.request.body || {};
    const workspaceId = body.workspace_id || ctx.request.headers['x-hdw-workspace-id'];
    const ownerMemberId = body.owner_member_id;
    const template = body.template;

    if (!workspaceId || !ownerMemberId || !template) {
      ctx.body = { code: -1, msg: 'workspace_id, owner_member_id and template are required' };
      return;
    }

    const id = template.id || `mcp-${crypto.randomUUID()}`;
    const metadata = {
      id,
      label: template.label || id,
      description: template.description || '',
      transport: template.transport || 'stdio',
      category: template.category || 'utilities',
      ...(template.authMode ? { authMode: template.authMode } : {}),
      ...(template.homepage ? { homepage: template.homepage } : {}),
      ...(template.example ? { example: template.example } : {}),
      ...(template.command ? { command: template.command } : {}),
      ...(template.args ? { args: template.args } : {}),
      ...(template.envFields ? { envFields: template.envFields } : {}),
      ...(template.url ? { url: template.url } : {}),
      ...(template.headerFields ? { headerFields: template.headerFields } : {}),
    };

    try {
      const k = this.getKnex();
      await k('resources').insert({
        id,
        workspace_id: workspaceId,
        kind: KIND,
        owner_member_id: ownerMemberId,
        metadata: JSON.stringify(metadata),
      });

      const row = await k('resources').where({ id }).first();
      const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {});
      ctx.body = {
        code: 0,
        msg: 'ok',
        data: {
          template: {
            resourceId: row.id,
            ownerMemberId: row.owner_member_id,
            ...meta,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          },
        },
      };
    } catch (err) {
      ctx.logger.error('[hdw] mcp create error:', err);
      ctx.body = { code: -1, msg: 'internal error', error: err.message };
    }
  }

  // ---- Update: PUT /hdw/api/mcp/:resourceId ----
  async update() {
    const { ctx } = this;
    const resourceId = ctx.params.resourceId;
    const body = ctx.request.body || {};
    const template = body.template;

    if (!template) {
      ctx.body = { code: -1, msg: 'template is required' };
      return;
    }

    const metadata = {
      id: resourceId,
      label: template.label || resourceId,
      description: template.description || '',
      transport: template.transport || 'stdio',
      category: template.category || 'utilities',
      ...(template.authMode ? { authMode: template.authMode } : {}),
      ...(template.homepage ? { homepage: template.homepage } : {}),
      ...(template.example ? { example: template.example } : {}),
      ...(template.command ? { command: template.command } : {}),
      ...(template.args ? { args: template.args } : {}),
      ...(template.envFields ? { envFields: template.envFields } : {}),
      ...(template.url ? { url: template.url } : {}),
      ...(template.headerFields ? { headerFields: template.headerFields } : {}),
    };

    try {
      const k = this.getKnex();
      const updated = await k('resources')
        .where({ id: resourceId, kind: KIND })
        .whereNull('deleted_at')
        .update({ metadata: JSON.stringify(metadata) });

      if (updated === 0) {
        ctx.body = { code: -1, msg: 'template not found' };
        return;
      }

      const row = await k('resources').where({ id: resourceId }).first();
      const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {});
      ctx.body = {
        code: 0,
        msg: 'ok',
        data: {
          template: {
            resourceId: row.id,
            ownerMemberId: row.owner_member_id,
            ...meta,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          },
        },
      };
    } catch (err) {
      ctx.logger.error('[hdw] mcp update error:', err);
      ctx.body = { code: -1, msg: 'internal error', error: err.message };
    }
  }

  // ---- Delete: DELETE /hdw/api/mcp/:resourceId ----
  async remove() {
    const { ctx } = this;
    const resourceId = ctx.params.resourceId;

    try {
      const k = this.getKnex();
      const deleted = await k('resources')
        .where({ id: resourceId, kind: KIND })
        .del();

      if (deleted === 0) {
        ctx.body = { code: -1, msg: 'template not found' };
        return;
      }

      ctx.body = { code: 0, msg: 'ok', data: { ok: true } };
    } catch (err) {
      ctx.logger.error('[hdw] mcp delete error:', err);
      ctx.body = { code: -1, msg: 'internal error', error: err.message };
    }
  }
}

module.exports = McpController;
