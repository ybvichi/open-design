'use strict';

const { createKnex } = require('../../utils/knex.js');
const blobStore = require('../../utils/blob-store.js');
const crypto = require('node:crypto');
const path = require('node:path');

const Controller = require('egg').Controller;

// Resource endpoints: publish (two-phase), get published head, pull, remove.
//
// The publish protocol:
//   1. Client PUTs a manifest (list of path+digest+size entries).
//   2. Server checks which blob digests it already has.
//   3. If all present: create resource_version, advance published ref,
//      return { version, versionId, missingBlobs: [] }.
//   4. If some missing: store pending_version_uploads row, return
//      { version, versionId, missingBlobs: [...] }. Client uploads blobs,
//      then re-PUTs the same manifest. On retry, all blobs present so
//      the version commits and the ref advances.
//
// Response format: raw JSON (NOT {code,msg,data}) to match the daemon's
// HdwCloudClient parsing logic. Errors use { error, message } with HTTP
// status codes.

class ResourceController extends Controller {
  getKnex() {
    if (!this._knex) {
      this._knex = createKnex(this.app.config.db);
    }
    return this._knex;
  }

  // ---- Publish: PUT /api/workspaces/:workspaceId/resources/:resourceId/versions ----
  async publish() {
    const { ctx } = this;
    const workspaceId = ctx.params.workspaceId;
    const resourceId = ctx.params.resourceId;
    const body = ctx.request.body;

    if (!body || !body.manifest || !body.manifest.entries) {
      ctx.status = 400;
      ctx.body = { error: 'invalid_request', message: 'manifest.entries is required' };
      return;
    }

    const kind = body.kind || 'project';
    const ref = body.ref || 'published';
    const metadata = body.metadata || null;
    const ownerMemberId = body.ownerMemberId || 'system';

    try {
      const k = this.getKnex();

      // Ensure the resource exists (upsert). Preserve an existing owner if
      // the caller didn't send one; otherwise use the provided ownerMemberId.
      let effectiveOwner = ownerMemberId;
      const existing = await k('resources').where({ id: resourceId }).first();
      if (existing && !body.ownerMemberId) {
        effectiveOwner = existing.owner_member_id;
      }
      await k('resources')
        .insert({
          id: resourceId,
          workspace_id: workspaceId,
          kind,
          owner_member_id: effectiveOwner,
          metadata: metadata ? JSON.stringify(metadata) : null,
        })
        .onConflict('id')
        .merge({
          deleted_at: null,
          ...(metadata ? { metadata: JSON.stringify(metadata) } : {}),
          ...(body.ownerMemberId ? { owner_member_id: effectiveOwner } : {}),
        });

      // Compute manifest digest and ensure all blobs are recorded.
      const manifestJson = JSON.stringify(body.manifest);
      const manifestDigest = crypto.createHash('sha256').update(manifestJson).digest('hex');

      // Record the manifest blob itself.
      await k('blobs')
        .insert({
          digest: manifestDigest,
          size: Buffer.byteLength(manifestJson, 'utf-8'),
          storage_path: `manifest/${manifestDigest}`,
        })
        .onConflict('digest')
        .ignore();
      await k('workspace_blob_refs')
        .insert({ workspace_id: workspaceId, digest: manifestDigest })
        .onConflict()
        .ignore();

      // Record each entry blob.
      for (const entry of body.manifest.entries) {
        await k('blobs')
          .insert({
            digest: entry.digest,
            size: entry.size,
            storage_path: `blob/${entry.digest}`,
          })
          .onConflict('digest')
          .ignore();
        await k('workspace_blob_refs')
          .insert({ workspace_id: workspaceId, digest: entry.digest })
          .onConflict()
          .ignore();
      }

      // Check which blobs are missing on disk.
      const allDigests = [manifestDigest, ...body.manifest.entries.map(e => e.digest)];
      const missing = [];
      for (const digest of allDigests) {
        if (!(await blobStore.exists(digest))) {
          missing.push(digest);
        }
      }

      if (missing.length > 0) {
        // Store a pending upload.
        const version = await this._nextVersionNumber(resourceId);
        const pendingId = crypto.randomUUID();
        await k('pending_version_uploads')
          .insert({
            id: pendingId,
            resource_id: resourceId,
            workspace_id: workspaceId,
            manifest_digest: manifestDigest,
            version,
            missing_digests: missing,
          })
          .onConflict('id')
          .merge({ missing_digests: missing });

        // Write the manifest blob to disk now (it's small and we have it).
        if (!(await blobStore.exists(manifestDigest))) {
          await blobStore.writeBlob(manifestDigest, Buffer.from(manifestJson, 'utf-8'));
        }

        ctx.body = { version, versionId: pendingId, missingBlobs: missing };
        return;
      }

      // All blobs present — commit the version.
      const version = await this._nextVersionNumber(resourceId);
      const versionId = await this._commitVersion(
        resourceId, workspaceId, version, manifestDigest, body.manifest.entries, ref,
      );

      ctx.body = { version, versionId, missingBlobs: [] };
    } catch (err) {
      ctx.logger.error('[hdw] publish error:', err);
      ctx.status = 500;
      ctx.body = { error: 'internal_error', message: err.message };
    }
  }

  // ---- Get published head: GET /api/workspaces/:ws/resources/:id/refs/:ref ----
  async head() {
    const { ctx } = this;
    const resourceId = ctx.params.resourceId;
    const ref = ctx.params.ref;

    try {
      const k = this.getKnex();
      const refRow = await k('resource_refs as rr')
        .join('resource_versions as rv', 'rv.id', 'rr.version_id')
        .where({ 'rr.resource_id': resourceId, 'rr.ref': ref })
        .select('rv.version', 'rv.id as version_id')
        .first();

      if (!refRow) {
        ctx.status = 404;
        ctx.body = { error: 'not_found', message: 'No published version for this ref' };
        return;
      }

      ctx.body = { version: refRow.version, versionId: refRow.version_id };
    } catch (err) {
      ctx.logger.error('[hdw] get head error:', err);
      ctx.status = 500;
      ctx.body = { error: 'internal_error', message: err.message };
    }
  }

  // ---- Pull: POST /api/workspaces/:ws/resources/:id/materialize ----
  async materialize() {
    const { ctx } = this;
    const resourceId = ctx.params.resourceId;
    const body = ctx.request.body || {};
    const ref = body.ref || 'published';

    try {
      const k = this.getKnex();
      const versionRow = await k('resource_refs as rr')
        .join('resource_versions as rv', 'rv.id', 'rr.version_id')
        .where({ 'rr.resource_id': resourceId, 'rr.ref': ref })
        .select('rv.version', 'rv.id as version_id', 'rv.manifest_digest')
        .first();

      if (!versionRow) {
        ctx.status = 404;
        ctx.body = { error: 'not_found', message: 'No published version for this ref' };
        return;
      }

      // Read the manifest blob from disk.
      const manifestBuffer = await blobStore.readBlob(versionRow.manifest_digest);
      const manifest = JSON.parse(manifestBuffer.toString('utf-8'));

      // Get the blob digests for this version.
      const blobsRows = await k('resource_version_blobs')
        .where({ version_id: versionRow.version_id })
        .select('digest');

      // Check which blobs are missing on disk.
      const missingBlobs = [];
      for (const row of blobsRows) {
        if (!(await blobStore.exists(row.digest))) {
          missingBlobs.push(row.digest);
        }
      }

      ctx.body = {
        version: versionRow.version,
        versionId: versionRow.version_id,
        manifest,
        missingBlobs,
      };
    } catch (err) {
      ctx.logger.error('[hdw] materialize error:', err);
      ctx.status = 500;
      ctx.body = { error: 'internal_error', message: err.message };
    }
  }

  // ---- Remove: DELETE /api/workspaces/:ws/resources/:id ----
  async remove() {
    const { ctx } = this;
    const resourceId = ctx.params.resourceId;

    try {
      const k = this.getKnex();
      const updated = await k('resources')
        .where({ id: resourceId })
        .whereNull('deleted_at')
        .update({ deleted_at: new Date() });

      if (updated === 0) {
        ctx.status = 404;
        ctx.body = { error: 'not_found', message: 'Resource not found or already deleted' };
        return;
      }

      ctx.status = 204;
      ctx.body = null;
    } catch (err) {
      ctx.logger.error('[hdw] remove resource error:', err);
      ctx.status = 500;
      ctx.body = { error: 'internal_error', message: err.message };
    }
  }

  // ---- Helpers ----

  async _nextVersionNumber(resourceId) {
    const k = this.getKnex();
    const row = await k('resource_versions')
      .where({ resource_id: resourceId })
      .max('version as max_version')
      .first();
    return (row.max_version || 0) + 1;
  }

  async _commitVersion(resourceId, workspaceId, version, manifestDigest, entries, ref) {
    const k = this.getKnex();
    const versionId = crypto.randomUUID();

    await k.transaction(async trx => {
      // Create the version row.
      await trx('resource_versions').insert({
        id: versionId,
        resource_id: resourceId,
        manifest_digest: manifestDigest,
        version,
      });

      // Link each blob to the version.
      const blobRows = entries.map(e => ({ version_id: versionId, digest: e.digest }));
      if (blobRows.length > 0) {
        // Insert ignore for duplicates
        for (const row of blobRows) {
          await trx('resource_version_blobs')
            .insert(row)
            .onConflict()
            .ignore();
        }
      }

      // Advance the ref (upsert).
      await trx('resource_refs')
        .insert({ resource_id: resourceId, ref, version_id: versionId })
        .onConflict(['resource_id', 'ref'])
        .merge({ version_id: versionId });

      // Clean up any pending upload for this resource.
      await trx('pending_version_uploads')
        .where({ resource_id: resourceId })
        .del();
    });

    return versionId;
  }
}

module.exports = ResourceController;
