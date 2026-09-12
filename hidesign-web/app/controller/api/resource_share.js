'use strict';

const { createKnex } = require('../../utils/knex.js');
const {
  getSharedSpaceTeamId,
  getSharedSpaceMemberId,
} = require('../../utils/ids.js');

const Controller = require('egg').Controller;

// Resource Shares: share skill/mcp resources to specific recipients in
// the shared space. Mirrors the project-sharing flow but targets
// resources (kind = skill or mcp) instead of projects.
//
// Key rules (same as workspace_project_shares):
//   1. Reference mode: resource stays in its home workspace.
//   2. Owner exclusion: sharer cannot see their own shared resources.
//   3. Recipient-scoped: each share targets specific recipients.
//   4. Cross-team stable IDs: uses shared-space member IDs.

class ResourceShareController extends Controller {
  getKnex() {
    if (!this._knex) {
      this._knex = createKnex(this.app.config.db);
    }
    return this._knex;
  }

  // ---- Share a resource to the shared space ----
  // POST /hdw/api/resource-share/share
  // body: { resource_id, kind, home_workspace_id, created_by_username, created_by_displayname?, recipients: [{username, displayname?}] }
  async share() {
    const { ctx } = this;
    const {
      resource_id: resourceId,
      kind = 'skill',
      home_workspace_id: homeWorkspaceId,
      created_by_username: createdByUsername,
      created_by_displayname: createdByDisplayname,
      recipients = [],
    } = ctx.request.body;

    if (!resourceId || !homeWorkspaceId || !createdByUsername) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 resource_id, home_workspace_id 或 created_by_username' };
      return;
    }
    if (!Array.isArray(recipients) || recipients.length === 0) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 recipients (至少选择一名成员)' };
      return;
    }
    if (kind !== 'skill' && kind !== 'mcp') {
      ctx.body = { code: -1, msg: 'FAIL', error: 'kind 必须是 skill 或 mcp' };
      return;
    }

    try {
      const k = this.getKnex();
      const sharedSpaceId = getSharedSpaceTeamId();
      const createdByMemberId = getSharedSpaceMemberId(createdByUsername);
      const now = new Date();

      // Deduplicate recipients by username and exclude the sharer
      const seen = new Set();
      const rows = [];
      for (const r of recipients) {
        if (!r.username || seen.has(r.username)) continue;
        seen.add(r.username);
        if (r.username === createdByUsername) continue;
        rows.push({
          id: `${sharedSpaceId}_${resourceId}_${r.username}`,
          resource_id: resourceId,
          kind,
          home_workspace_id: homeWorkspaceId,
          shared_space_id: sharedSpaceId,
          recipient_member_id: getSharedSpaceMemberId(r.username),
          recipient_username: r.username,
          created_by_member_id: createdByMemberId,
          created_by_username: createdByUsername,
          created_by_displayname: createdByDisplayname || null,
          created_at: now,
        });
      }

      if (rows.length === 0) {
        ctx.body = { code: -1, msg: 'FAIL', error: '没有需要新增的分享 (接收人列表为空或全是自己)' };
        return;
      }

      await k('workspace_resource_shares')
        .insert(rows)
        .onConflict('id')
        .merge({
          created_by_member_id: createdByMemberId,
          created_by_username: createdByUsername,
          created_by_displayname: createdByDisplayname || null,
          created_at: now,
        });

      ctx.body = {
        code: 0,
        msg: 'SUCCESS',
        data: {
          shared: rows.length,
          skipped: recipients.length - rows.length,
          shared_space_id: sharedSpaceId,
        },
      };
    } catch (err) {
      ctx.logger.error('ResourceShare share error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // ---- List resources shared TO me ----
  // GET /hdw/api/resource-share/shared-with-me?username=xxx&kind=skill
  async sharedWithMe() {
    const { ctx } = this;
    const username = ctx.query.username;
    const kind = ctx.query.kind || 'skill';

    if (!username) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 username' };
      return;
    }

    try {
      const k = this.getKnex();
      const sharedSpaceId = getSharedSpaceTeamId();
      const recipientMemberId = getSharedSpaceMemberId(username);

      const shares = await k('workspace_resource_shares as s')
        .where({
          's.shared_space_id': sharedSpaceId,
          's.recipient_member_id': recipientMemberId,
          's.kind': kind,
        })
        .select(
          's.id as share_id',
          's.resource_id',
          's.kind',
          's.home_workspace_id',
          's.created_by_username as shared_by_username',
          's.created_by_displayname as shared_by_displayname',
          's.created_at as shared_at',
        )
        .orderBy('s.created_at', 'desc');

      // Enrich with resource metadata from the home workspace
      const resources = [];
      for (const s of shares) {
        try {
          const row = await k('resources')
            .where({ id: s.resource_id, kind: s.kind })
            .whereNull('deleted_at')
            .select('id', 'owner_member_id', 'metadata', 'created_at', 'updated_at')
            .first();

          let metadata = row?.metadata;
          if (typeof metadata === 'string') {
            try { metadata = JSON.parse(metadata); } catch { /* keep string */ }
          }

          resources.push({
            shareId: s.share_id,
            resourceId: s.resource_id,
            kind: s.kind,
            homeWorkspaceId: s.home_workspace_id,
            sharedByUsername: s.shared_by_username,
            sharedByDisplayname: s.shared_by_displayname || null,
            sharedAt: s.shared_at instanceof Date ? s.shared_at.toISOString() : String(s.shared_at),
            ownerMemberId: row?.owner_member_id || null,
            metadata: metadata || null,
            createdAt: row?.created_at || null,
            updatedAt: row?.updated_at || null,
          });
        } catch {
          // Skip resources whose home workspace is unreachable
        }
      }

      ctx.body = {
        code: 0,
        msg: 'SUCCESS',
        data: { resources },
      };
    } catch (err) {
      ctx.logger.error('ResourceShare sharedWithMe error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // ---- List resources I shared TO others ----
  // GET /hdw/api/resource-share/shared-by-me?username=xxx&kind=skill
  async sharedByMe() {
    const { ctx } = this;
    const username = ctx.query.username;
    const kind = ctx.query.kind || 'skill';

    if (!username) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 username' };
      return;
    }

    try {
      const k = this.getKnex();
      const sharedSpaceId = getSharedSpaceTeamId();
      const creatorMemberId = getSharedSpaceMemberId(username);

      const shares = await k('workspace_resource_shares')
        .where({
          shared_space_id: sharedSpaceId,
          created_by_member_id: creatorMemberId,
          kind,
        })
        .select(
          'id as share_id',
          'resource_id',
          'kind',
          'home_workspace_id',
          'recipient_username',
          'recipient_member_id',
          'created_at as shared_at',
        )
        .orderBy('created_at', 'desc');

      ctx.body = {
        code: 0,
        msg: 'SUCCESS',
        data: { shares },
      };
    } catch (err) {
      ctx.logger.error('ResourceShare sharedByMe error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // ---- Unshare a resource from a specific recipient ----
  // DELETE /hdw/api/resource-share/:share_id
  async unshare() {
    const { ctx } = this;
    const { share_id: shareId } = ctx.params;

    if (!shareId) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 share_id' };
      return;
    }

    try {
      const k = this.getKnex();
      const deleted = await k('workspace_resource_shares')
        .where({ id: shareId })
        .del();

      if (deleted === 0) {
        ctx.body = { code: -1, msg: 'FAIL', error: '分享记录不存在' };
        return;
      }
      ctx.body = { code: 0, msg: 'SUCCESS', data: { deleted: true } };
    } catch (err) {
      ctx.logger.error('ResourceShare unshare error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }

  // ---- Remove all shares for a resource (called when resource is deleted) ----
  // DELETE /hdw/api/resource-share/resource/:resource_id
  async unshareResource() {
    const { ctx } = this;
    const { resource_id: resourceId } = ctx.params;

    if (!resourceId) {
      ctx.body = { code: -1, msg: 'FAIL', error: '缺少必要参数 resource_id' };
      return;
    }

    try {
      const k = this.getKnex();
      await k('workspace_resource_shares')
        .where({ resource_id: resourceId })
        .del();
      ctx.body = { code: 0, msg: 'SUCCESS', data: { deleted: true } };
    } catch (err) {
      ctx.logger.error('ResourceShare unshareResource error:', err);
      ctx.body = { code: -1, msg: 'FAIL', error: err.message };
    }
  }
}

module.exports = ResourceShareController;
