'use strict';

// const jwt = require('jwt-simple');
const { Controller } = require('egg');

module.exports = class extends Controller {
  async tgetRooms() {
    const { ctx, service } = this;
    return ctx.body = await service.game.getRooms();
  }
  async tgetRoom() {
    const { ctx, service } = this;
    const { id } = ctx.params || {};
    return ctx.body = await service.game.getRoom(id);
  }
  async tcreateRoom() {
    const { ctx, service } = this;
    const body = ctx.request.body || {};
    return ctx.body = await service.game.createRoom(body);
  }
  async tjoinRoom() {
    const { ctx, service } = this;
    const { id } = ctx.params || {};
    return ctx.body = await service.game.joinRoom(id);
  }
  async tstartGame() {
    const { ctx, service } = this;
    const { id } = ctx.params || {};
    return ctx.body = await service.game.startGame(id);
  }
  async tgetCurrentAreas() {
    const { ctx, service } = this;
    const { roomId } = ctx.params || {};
    return ctx.body = await service.game.getCurrentAreas(roomId);
  }
  async tgetGameResult() {
    const { ctx, service } = this;
    const { roomId } = ctx.params || {};
    return ctx.body = await service.game.getGameResult(roomId);
  }
  // async update() {
  //     const { ctx, service } = this;
  //     const { id } = ctx.params;
  //     const payload = ctx.request.body || {};
  //     return ctx.body = await service.user.update(id, payload);
  // }
};
