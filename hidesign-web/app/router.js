'use strict';

/**
 * @param {Egg.Application} app - egg application
 */
module.exports = app => {
  const { router, controller } = app;
  router.get('/', controller.home.index);
  // api:test // 测试路由
  router.get('/hdw/webapi/v1/test', controller.api.test.index);
  // api:team // 团队管理
  router.post('/hdw/webapi/v1/team/add', controller.api.team.add);
  router.del('/hdw/webapi/v1/team/:workspace_id', controller.api.team.del);
  router.post('/hdw/webapi/v1/team/rename', controller.api.team.rename);
  router.post('/hdw/webapi/v1/team/invite', controller.api.team.invite);
  router.get('/hdw/webapi/v1/team/my', controller.api.team.myTeams);
  router.get('/hdw/webapi/v1/team/:workspace_id', controller.api.team.detail);
 router.get('/hdw/webapi/v1/team/:workspace_id/members', controller.api.team.members);
 router.get('/hdw/webapi/v1/team/:workspace_id/member/check', controller.api.team.checkMember);
  router.get('/hdw/webapi/v1/team/:workspace_id/member/:workspace_member_id', controller.api.team.memberDetail);
 // api:team/member // 成员管理
  router.post('/hdw/webapi/v1/team/member/remove', controller.api.team.removeMember);
  router.post('/hdw/webapi/v1/team/member/role', controller.api.team.updateRole);
  router.post('/hdw/webapi/v1/team/quit', controller.api.team.quit);
  router.post('/hdw/webapi/v1/team/transfer', controller.api.team.transfer);
  // api:folder // 文件夹管理
  router.post('/hdw/webapi/v1/folder/add', controller.api.folder.add);
  router.del('/hdw/webapi/v1/folder/:folder_id', controller.api.folder.del);
  router.post('/hdw/webapi/v1/folder/rename', controller.api.folder.rename);
  router.get('/hdw/webapi/v1/folder/list', controller.api.folder.list);
  // api:folder/project // 文件夹-项目关联管理
  router.post('/hdw/webapi/v1/folder/project/add', controller.api.folder.addProject);
  router.post('/hdw/webapi/v1/folder/project/remove', controller.api.folder.removeProject);
  router.get('/hdw/webapi/v1/folder/project/list', controller.api.folder.listProjects);
  router.post('/hdw/webapi/v1/folder/project/move', controller.api.folder.moveProject);
  // // 用户登录
  // router.post('/webapi/login', controller.api.login.login);
  // // api:export // 导出数据接口
  // router.post('/webapi/v1/export/zip/:dataType', controller.api.export.zip);
  // // api:idea // 灵感读取
  // router.get('/webapi/v1/idea/list', controller.api.idea.list);
  // router.post('/webapi/v1/idea/add', controller.api.idea.add);
  // router.post('/webapi/v1/idea/update', controller.api.idea.update);
  // router.del('/webapi/v1/idea/:id', controller.api.idea.del);
  //   // api:issue // 评论读取
  // router.get('/webapi/v1/issue/list', controller.api.issue.list);
  // router.post('/webapi/v1/issue/add', controller.api.issue.add);
  // router.post('/webapi/v1/issue/update', controller.api.issue.update);
  // router.del('/webapi/v1/issue/:id', controller.api.issue.del);
  //   // api:issue // 回复读取
  // router.get('/webapi/v1/reply/list', controller.api.reply.list);
  // router.post('/webapi/v1/reply/add', controller.api.reply.add);
  // router.post('/webapi/v1/reply/update', controller.api.reply.update);
  // router.del('/webapi/v1/reply/:id', controller.api.reply.del);
  // // api:task // 任务读取
  // router.get('/webapi/v1/task/list', controller.api.task.list);
  // router.post('/webapi/v1/task/add', controller.api.task.add);
  // router.post('/webapi/v1/task/update', controller.api.task.update);
  // router.get('/webapi/v1/task/delAll', controller.api.task.deleteAll);
  // // api:component //组件读取
  // router.get('/webapi/v1/component/json', controller.api.component.json);
  // router.get('/webapi/v1/component/category', controller.api.component.category);
  // router.post('/webapi/v1/component/categoryByCondition', controller.api.component.categoryByCondition);
  // // api:library //知识库读写
  // // router.get('/webapi/v1/library/list', controller.api.library.list);
  // // router.post('/webapi/v1/library/pub', controller.api.library.publish);
  //   // api:dsl // 导出DSL
  // router.del('/webapi/v1/dsl/deleteAllIcons', controller.api.dsl.deleteAllIcons);
  // router.del('/webapi/v1/dsl/deleteAllCategories', controller.api.dsl.deleteAllCategories);
  // router.post('/webapi/v1/dsl/deleteAllComponents', controller.api.dsl.deleteAllComponents);
  // router.post('/webapi/v1/dsl/categories', controller.api.dsl.categories);
  // router.post('/webapi/v1/dsl/addCategory', controller.api.dsl.addCategory);
  // router.post('/webapi/v1/dsl/addCategories', controller.api.dsl.addCategories);
  // router.post('/webapi/v1/dsl/updateCategory', controller.api.dsl.updateCategory);
  // router.post('/webapi/v1/dsl/components', controller.api.dsl.components);
  // router.get('/webapi/v1/dsl/components/p/:industry/:product', controller.api.dsl.componentsByProduct);
  // router.get('/webapi/v1/dsl/components/f/:fileKey', controller.api.dsl.componentsByFileKey);
  // router.post('/webapi/v1/dsl/addComponent', controller.api.dsl.addComponent);
  // router.post('/webapi/v1/dsl/addComponents', controller.api.dsl.addComponents);
  // router.post('/webapi/v1/dsl/deleteTemplate', controller.api.dsl.deleteTemplate);
  // router.post('/webapi/v1/dsl/addTemplate', controller.api.dsl.addTemplate);
  // router.post('/webapi/v1/dsl/getTemplate', controller.api.dsl.getTemplate);
  // router.post('/webapi/v1/dsl/getTemplateSingle', controller.api.dsl.getTemplateSingle);
  // router.get('/webapi/v1/dsl/templates/p/:industry/:product', controller.api.dsl.templatesByProduct);
  // router.post('/webapi/v1/dsl/icons', controller.api.dsl.icons);
  // router.post('/webapi/v1/dsl/addIcons', controller.api.dsl.addIcons);
  // router.post('/webapi/v1/dsl/addLinkData', controller.api.dsl.addLinkData);
  // router.get('/webapi/v1/dsl/link/:id', controller.api.dsl.getLinkData);

  // router.post('/webapi/v1/dsl/addCoverData', controller.api.dsl.addCoverData);
  // router.get('/webapi/v1/dsl/cover/:id', controller.api.dsl.getCoverData);
  // router.get('/webapi/v1/dsl/deleteCoverDataForTask', controller.api.dsl.deleteCoverDataForTask);
  // // api:uupm // 导出UI-UX-Pro-Max方法
  // router.get('/webapi/v1/uupm/search', controller.api.uupm.search);
  // router.post('/webapi/v1/uupm/searchAll', controller.api.uupm.searchAll);
  // // api:mcp // 导出mcp服务
  // router.post('/webapi/v1/mcp', controller.api.mcp.index);
  //   // api:od // 导出open design服务

  // router.get('/webapi/v1/od/templates', controller.api.od.templates);
  // router.get('/webapi/v1/od/template/scope/:scope/:sourceProjectId', controller.api.od.getTemplateByScope);
  // router.get('/webapi/v1/od/template/:id', controller.api.od.getTemplateById);
  // router.get('/webapi/v1/od/template/:sourceProjectId/:name', controller.api.od.getTemplate);
  // router.post('/webapi/v1/od/template', controller.api.od.addTemplate);
  // // api:tool // 导出工具
  // router.post('/webapi/v1/tool/font2svg', controller.api.tool.font2svg);
  // // api:resources // 静态资源
  // router.get('/resources/html/:username/:fileName(.*)', controller.api.resources.getHtml);
  // // api:tracking // AI追踪数据
  // router.post('/webapi/v1/tracking/report', controller.api.tracking.report);
  // router.get('/webapi/v1/tracking/list', controller.api.tracking.list);
  // router.get('/webapi/v1/tracking/summary', controller.api.tracking.summary);
  // router.get('/webapi/v1/tracking/heat', controller.api.tracking.heat);
  // //router.post('/webapi/v1/tracking/clear', controller.api.tracking.clear);
};
