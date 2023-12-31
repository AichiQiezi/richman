'use strict';
const uuid = require('uuid');
const Controller = require('egg').Controller;

module.exports = class extends Controller {
  /**
   * 扔骰子
   */
  async throwDice() {
    const {
      ctx,
      app,
      config
    } = this;
    const message = ctx.args[0] || {};
    try {
      let userInfo = await app.redis.hgetall(config.redis.prefix + 'token-' + message.token);
      let roomInfo = await app.redis.hgetall(message.roomId);
      if (!ctx.helper.isEmpty(roomInfo) && !ctx.helper.isEmpty(roomInfo.players)) {
        let players = JSON.parse(roomInfo.players);
        let area = JSON.parse(roomInfo.area);
        if (!ctx.helper.isEmpty(players[userInfo._id])) {

          let playerIds = roomInfo.playerIds.split(',');
          if (playerIds[roomInfo.currentRound] === userInfo._id) {
            // 获得骰子点数
            let random = Math.floor(Math.random() * 6) + 1;
            if (random === 7) {
              random = 6;
            }

            // 更新信息
            let before = players[userInfo._id].step;
            let beforeRound = roomInfo.currentRound;
            players[userInfo._id].step = (players[userInfo._id].step + random) % 34;
            players[userInfo._id].area = area[players[userInfo._id].step];

            // 得到下一轮玩家id
            let isNextPlayerBot = false
            while (true) {
              roomInfo.currentRound = (Number(roomInfo.currentRound) + 1) % (playerIds.length);
              let tmpPlayer = players[roomInfo.playerIds.split(',')[roomInfo.currentRound]]
              if (tmpPlayer.status === 'normal') {
                if (tmpPlayer.username.includes('bot')){
                  //下一个玩家是 bot
                  isNextPlayerBot = true
                }
                break;
              }
            }

            // 目的地区的影响（地皮、机会、命运、海洋、监狱、起点）
            let result = {
              _id: userInfo._id,
              nextPlayer: playerIds[roomInfo.currentRound],
              result: 'run',
              step: random,
              area: area[players[userInfo._id].step],
              effect: '',
              throughStart: false,
              payFor: '',
              isNextPlayerBot : isNextPlayerBot
            };

            const nsp = app.io.of('/');

            // 经过起点得2000元
            if (before > players[userInfo._id].step) {
              players[userInfo._id].money += 2000;
              result.throughStart = true;
            }

            // 走到机会、命运
            if (result.area.type === 'chance' || result.area.type === 'fate') {
              if (result.area.type === 'chance') {
                let randomChance = Math.floor(Math.random() * Object.keys(config.chances).length) + 1;
                if (randomChance === Object.keys(config.chances).length) {
                  randomChance = Object.keys(config.chances).length - 1;
                }
                result.effect = config.chances[randomChance];
              }
              else {
                let randomFate = Math.floor(Math.random() * Object.keys(config.chances).length) + 1;
                if (randomFate === Object.keys(config.chances).length) {
                  randomFate = Object.keys(config.chances).length - 1;
                }
                result.effect = config.fates[randomFate];
              }

              let houseMoey = calcHouseMoey(area, userInfo._id);
              if (Number(players[userInfo._id].money) + result.effect.effect > 0) {
                // 现金足够支付
                players[userInfo._id].money = Number(players[userInfo._id].money) + result.effect.effect;
              }
              else if (Number(players[userInfo._id].money) + result.effect.effect + houseMoey > 0) {
                // 现金不足
                // 需出售房产
                result.result = 'needSaleHouse';
                let afterRound = roomInfo.currentRound;
                roomInfo.currentRound = beforeRound;

                // 推送卖方倒计时
                // 标识倒计时，用来消除倒计时
                result.orderId = uuid.v1();
                countDown(30, result.orderId, userInfo._id, message.roomId, playerIds[afterRound], afterRound, app, async () => {
                  let roomInfo2 = await app.redis.hgetall(message.roomId);
                  let players2 = JSON.parse(roomInfo2.players);
                  let area2 = JSON.parse(roomInfo2.area);

                  let result2 = '';
                  let sale = [];
                  if (Number(players2[userInfo._id].money) + result.effect.effect > 0) {
                    players2[userInfo._id].money = Number(players2[userInfo._id].money) + result.effect.effect;
                    result2 = 'moneyEnough';
                  } else {
                    // 现金依然不足
                    // 依次出售拥有的房产直至现金足够为止
                    for (let i in area2) {
                      if (area2[i].owner == userInfo._id && area2[i].type == 'place') {
                        sale.push(area2[i]);
                        let flag = false;
                        // 卖房
                        for (let j = Number(area2[i].rank) - 1; j > 0; j--) {
                          players2[userInfo._id].money += area2[j].upgradePrice / 2;
                          area2[i].rank = Number(area2[i].rank) - 1;
                          if (Number(players2[userInfo._id].money) + result.effect.effect > 0) {
                            players2[userInfo._id].money = Number(players2[userInfo._id].money) + result.effect.effect;
                            flag = true;
                            break;
                          }
                        }
                        if (flag) {
                          // 钱已足够
                          break;
                        }

                        if (Number(area2[i].rank) < 2) {
                          // 卖地
                          players2[userInfo._id].money += area2[i].price / 2;
                          area2[i].owner = '';
                          area2[i].rank = 0;
                        }

                        if (Number(players2[userInfo._id].money) + result.effect.effect > 0) {
                          // 钱已足够
                          players2[userInfo._id].money = Number(players2[userInfo._id].money) + result.effect.effect;
                          break;
                        }
                      }
                    }

                    // 广播点数和目的地区信息
                    result2 = 'autoSaleHouse';
                  }

                  // 更新房产、资金
                  await app.redis.hmset(message.roomId, {
                    players: JSON.stringify(players2),
                    area: JSON.stringify(area2)
                  });
                  nsp.emit(message.roomId + '-needSaleHouseBack', {
                    _id: userInfo._id,
                    result: result2,
                    payPlayerMoney: players2[userInfo._id].money,
                    effect: result.effect.effect,
                    payFor: result.area.owner,
                    area: result.area,
                    sale: sale
                  });
                });
              }
              else if (Number(players[userInfo._id].money) + result.effect.effect + houseMoey < 0) {
                // 破产
                // 无力支付
                // 将房产全部变卖后所有资金给对方
                result.result = 'nothingToPay';
                players[userInfo._id].money = -1;
                players[userInfo._id].status = 'bankrupt';
                roomInfo.aliveNum -= 1;
                let res = await app.model.Game.update({
                  roomId: roomInfo.roomId,
                  'players.userId': app.mongoose.Types.ObjectId(userInfo._id)
                }, {
                  aliveNum: roomInfo.aliveNum,
                  'players.$.status': 'bankrupt',
                  'players.$.rank': roomInfo.aliveNum + 1
                });

                // 拥有的房产出售变为无主
                for (let i in area) {
                  if (area[i].owner == userInfo._id && area[i].type == 'place') {
                    area[i].owner = '';
                    area[i].rank = 0;
                  }
                }
              }
            }
            else if (result.area.type === 'prison') {
              result.effect = {
                text: '入狱',
                result: '停止收益，需转轮盘逃出',
                effect: 0
              };
            }
            else if (result.area.type === 'place') {
              if (ctx.helper.isEmpty(result.area.owner)) {
                result.result = 'buy';
                let afterRound = roomInfo.currentRound;
                roomInfo.currentRound = beforeRound;
                result.nextPlayer = playerIds[roomInfo.currentRound];

                // 推送够买升级倒计时
                // 标识倒计时，用来消除倒计时
                result.orderId = uuid.v1();
                countDown(20, result.orderId, userInfo._id, message.roomId, playerIds[afterRound], afterRound, app);
              } else if (result.area.owner === userInfo._id) {
                result.result = 'upgrade';
                let afterRound = roomInfo.currentRound;
                roomInfo.currentRound = beforeRound;
                result.nextPlayer = playerIds[roomInfo.currentRound];

                result.orderId = uuid.v1();
                countDown(20, result.orderId, userInfo._id, message.roomId, playerIds[afterRound], afterRound, app);
              } else {
                result.result = 'pay';
                result.payFor = result.area.owner;

                let houseMoey = calcHouseMoey(area, userInfo._id);
                if (Number(players[userInfo._id].money) > Number(result.area.income[result.area.rank])) {
                  players[userInfo._id].money -= result.area.income[result.area.rank];
                  players[result.area.owner].money += Number(result.area.income[result.area.rank]);
                } else if (Number(players[userInfo._id].money) + houseMoey > Number(result.area.income[result.area.rank])) {
                  // 现金不足
                  // 需出售房产
                  result.result = 'needSaleHouse';
                  let afterRound = roomInfo.currentRound;
                  roomInfo.currentRound = beforeRound;

                  // 推送卖方倒计时
                  // 标识倒计时，用来消除倒计时
                  result.orderId = uuid.v1();
                  countDown(30, result.orderId, userInfo._id, message.roomId, playerIds[afterRound], afterRound, app, async () => {
                    let roomInfo2 = await app.redis.hgetall(message.roomId);
                    let players2 = JSON.parse(roomInfo2.players);
                    let area2 = JSON.parse(roomInfo2.area);

                    let result2 = '';
                    let sale = [];
                    if (Number(players2[userInfo._id].money) > Number(result.area.income[result.area.rank])) {
                      // 当前现金已足够支付
                      players2[userInfo._id].money -= result.area.income[result.area.rank];
                      players2[result.area.owner].money += Number(result.area.income[result.area.rank]);
                      result2 = 'moneyEnough';
                    } else {
                      // 现金依然不足
                      // 依次出售拥有的房产直至现金足够为止
                      for (let i in area2) {
                        if (area2[i].owner == userInfo._id && area2[i].type == 'place') {
                          // area2[i].houseId = i;
                          sale.push(area2[i]);
                          debugger;
                          let flag = false;
                          // 卖房
                          for (let j = Number(area2[i].rank) - 1; j > 0; j--) {
                            players2[userInfo._id].money += area2[i].upgradePrice / 2;
                            area2[i].rank = Number(area2[i].rank) - 1;
                            if (Number(players2[userInfo._id].money) > Number(result.area.income[result.area.rank])) {
                              players2[userInfo._id].money -= result.area.income[result.area.rank];
                              players2[result.area.owner].money += Number(result.area.income[result.area.rank]);
                              flag = true;
                              break;
                            }
                          }
                          if (flag) {
                            // 钱已足够
                            break;
                          }

                          if (Number(area2[i].rank) < 2) {
                            // 卖地
                            players2[userInfo._id].money += area2[i].price / 2;
                            area2[i].owner = '';
                            area2[i].rank = 0;
                          }

                          if (Number(players2[userInfo._id].money) > Number(result.area.income[result.area.rank])) {
                            // 钱已足够
                            players2[userInfo._id].money -= result.area.income[result.area.rank];
                            players2[result.area.owner].money += Number(result.area.income[result.area.rank]);
                            break;
                          }
                        }
                      }

                      result2 = 'autoSaleHouse';
                    }
                    // 更新房产、资金
                    await app.redis.hmset(message.roomId, {
                      players: JSON.stringify(players2),
                      area: JSON.stringify(area2)
                    });
                    nsp.emit(message.roomId + '-needSaleHouseBack', {
                      _id: userInfo._id,
                      result: result2,
                      payPlayerMoney: players2[userInfo._id].money,
                      getPlayerMoney: players2[result.area.owner].money,
                      effect: Number(result.area.income[result.area.rank]),
                      payFor: result.area.owner,
                      area: result.area,
                      sale: sale
                    });
                  });

                } else if (Number(players[userInfo._id].money) + houseMoey < Number(result.area.income[result.area.rank])) {
                  // 破产
                  // 无力支付
                  // 将房产全部变卖后所有资金给对方
                  result.result = 'nothingToPay';
                  players[userInfo._id].money = -1;
                  players[result.area.owner].money += Number(players[result.area.owner].money) + houseMoey;
                  players[userInfo._id].status = 'bankrupt';
                  roomInfo.aliveNum -= 1;

                  let res = await app.model.Game.update({
                    roomId: roomInfo.roomId,
                    'players.userId': app.mongoose.Types.ObjectId(userInfo._id)
                  }, {
                    aliveNum: roomInfo.aliveNum,
                    'players.$.status': 'bankrupt',
                    'players.$.rank': roomInfo.aliveNum + 1
                  });

                  // 拥有的房产出售变为无主
                  for (let i in area) {
                    if (area[i].owner == userInfo._id && area[i].type == 'place') {
                      area[i].owner = '';
                      area[i].rank = 0;
                    }
                  }

                  const nsp = app.io.of('/');
                  nsp.emit(message.roomId + '-bankrupt', {
                    _id: userInfo._id,
                    result: 'bankrupt'
                  });
                }
              }
            }

            // 只剩一个玩家存活，游戏结束
            if (roomInfo.aliveNum <= 1) {
              await app.model.Game.updateOne({
                roomId: roomInfo.roomId,
                'players.status': 'normal'
              }, {
                status: '已结束',
                endTime: new Date(),
                'players.$.status': 'win',
                'players.$.rank': 1
              });

              let gameInfo = await app.model.Game.find({
                roomId: roomInfo.roomId
              });
              let winMatch = {};
              let loseMatch = {
                $or: []
              };
              let integral = 0;
              for (let i in gameInfo.players) {
                if (gameInfo.players[i].rank === 1) {
                  winMatch._id = app.mongoose.Types.ObjectId(gameInfo.players[i].userId);
                } else {
                  integral += 200;
                  loseMatch.$or.push({
                    _id: app.mongoose.Types.ObjectId(gameInfo.players[i].userId)
                  });
                }
              }

              app.model.User.updateOne(winMatch, {
                $inc: {
                  integral: integral
                }
              });

              app.model.User.updateMany(loseMatch, {
                $inc: {
                  integral: -200
                }
              });

              await app.redis.del(message.roomId);

              nsp.emit(message.roomId + '-gameOver', {
                _id: userInfo._id
              });
            } else {
              await app.redis.hmset(message.roomId, {
                players: JSON.stringify(players),
                currentRound: roomInfo.currentRound,
                aliveNum: roomInfo.aliveNum
              });
            }

            // 广播点数和目的地区信息
            nsp.emit(message.roomId + '-throwDiceBack', result);
          } else {
            const nsp = app.io.of('/');
            nsp.emit(message.roomId + '-throwDiceBack', {
              _id: userInfo._id,
              nextPlayer: playerIds[roomInfo.currentRound],
              result: 'noRound',
              throughStart: false
            });
          }
        }
      }
    } catch (error) {
      app.logger.error(error);
    }
  }

  /**
   * 选择是否够买
   */
  async buyArea() {
    const {
      ctx,
      app,
      config
    } = this;
    const message = ctx.args[0] || {};
    try {
      let userInfo = await app.redis.hgetall(config.redis.prefix + 'token-' + message.token);
      let roomInfo = await app.redis.hgetall(message.roomId);
      if (!ctx.helper.isEmpty(roomInfo) && !ctx.helper.isEmpty(roomInfo.players)) {
        let players = JSON.parse(roomInfo.players);
        let area = JSON.parse(roomInfo.area);
        if (!ctx.helper.isEmpty(players[userInfo._id])) {
          let playerIds = roomInfo.playerIds.split(',');
          if (playerIds[roomInfo.currentRound] === userInfo._id) {
            let result = 'noBuy';
            if (message.isBuy) {
              if (area[players[userInfo._id].step].owner === '') {
                if (players[userInfo._id].money > area[players[userInfo._id].step].price) {
                  area[players[userInfo._id].step].owner = userInfo._id;
                  area[players[userInfo._id].step].rank += 1;
                  players[userInfo._id].money -= area[players[userInfo._id].step].price;
                  result = 'buy';
                } else {
                  result = 'noMoney';
                }
              } else if (area[players[userInfo._id].step].owner === userInfo._id) {
                if (players[userInfo._id].money > area[players[userInfo._id].step].upgradePrice) {
                  players[userInfo._id].money -= area[players[userInfo._id].step].upgradePrice;
                  area[players[userInfo._id].step].rank += 1;
                  result = 'upgrade';
                } else {
                  result = 'noMoney';
                }
              } else {
                result = 'isBought';
              }
            }
            while (true) {
              roomInfo.currentRound = (Number(roomInfo.currentRound) + 1) % (playerIds.length);
              if (players[roomInfo.playerIds.split(',')[roomInfo.currentRound]].status === 'normal') {
                break;
              }
            }
            await app.redis.hmset(message.roomId, {
              players: JSON.stringify(players),
              area: JSON.stringify(area),
              currentRound: roomInfo.currentRound % playerIds.length
            });
            // 标记已处理过
            await app.redis.set(message.orderId, true);
            const nsp = app.io.of('/');
            nsp.emit(message.roomId + '-buyAreaBack', {
              _id: userInfo._id,
              nextPlayer: playerIds[roomInfo.currentRound],
              money: players[userInfo._id].money,
              result: result,
              area: area[players[userInfo._id].step]
            });
          } else {
            const nsp = app.io.of('/');
            nsp.emit(message.roomId + '-buyAreaBack', {
              _id: userInfo._id,
              nextPlayer: playerIds[roomInfo.currentRound],
              result: 'noRound'
            });
          }
        }
      }
    } catch (error) {
      app.logger.error(error);
    }
  }

  /**
   * 出售一间房屋或地皮
   */
  async saleHouse() {
    const {
      ctx,
      app,
      config
    } = this;
    const message = ctx.args[0] || {};
    try {
      let userInfo = await app.redis.hgetall(config.redis.prefix + 'token-' + message.token);
      let roomInfo = await app.redis.hgetall(message.roomId);
      if (!ctx.helper.isEmpty(roomInfo) && !ctx.helper.isEmpty(roomInfo.players)) {
        let players = JSON.parse(roomInfo.players);
        let areas = JSON.parse(roomInfo.area);

        let result = '';
        let area = areas[message.id];
        if (area.owner == userInfo._id && Number(area.rank) > 0 && area.type == 'place') {

          if (Number(area.rank) > 1) {
            areas[message.id].rank = Number(area.rank) - 1;
            players[userInfo._id].money = Number(players[userInfo._id].money) + area.upgradePrice / 2;
            result = 'house';
          } else {
            areas[message.id].rank = 0;
            areas[message.id].owner = '';
            players[userInfo._id].money = Number(players[userInfo._id].money) + area.price / 2;
            result = 'place';
          }
        } else {
          result = 'noOwner';
        }

        await app.redis.hmset(message.roomId, {
          players: JSON.stringify(players),
          area: JSON.stringify(areas)
        });
        const nsp = app.io.of('/');
        nsp.emit(message.roomId + '-saleHouseBack', {
          _id: userInfo._id,
          username: userInfo.username,
          result: result,
          area: area,
          money: players[userInfo._id].money
        });
      }
    } catch (error) {
      app.logger.error(error);
    }
  }

  /**
   * 添加一个 bot
   */
  async addBot() {
    const {
      ctx,
      app,
      config
    } = this;
    // 获取消息对象
    const message = ctx.args[0] || {};
    let roomId = message.roomId
    try {
      // 查询 redis 合法校验
      let roomInfo = await app.redis.hgetall(roomId);
      if (ctx.helper.isEmpty(roomInfo) || roomInfo.userNum >= roomInfo.max || roomInfo.status !== "等待") {
        return;
      }

      let players = JSON.parse(roomInfo.players);
      let colors = roomInfo.colors.split(',');
      let random = Math.floor(Math.random() * colors.length) <= colors.length - 1 ? Math.floor(Math.random() * colors.length) : colors.length - 1;
      let color = (colors.splice(random, 1))[0];
      //创建一个 bot 对象，id 随机生成
      let botInfo = {
        id: '',
        username: ''
      };
      botInfo.id = uuid.v1();
      botInfo.username = 'bot-' + color

      players[botInfo.id] = {
        username: botInfo.username,
        step: 0,
        money: roomInfo.initMoney,
        status: 'normal',
        color: color,
        position: {
          x: 91.67,
          y: 85.815
        },
        area: config.country[0],
      }

      let playerIds = roomInfo.playerIds += ',' + botInfo._id;
      await app.redis.hmset(roomId, {
        colors: colors,
        players: JSON.stringify(players),
        playerIds: playerIds,
        userNum: Number(roomInfo.userNum) + 1,
        aliveNum: Number(roomInfo.aliveNum) + 1
      });

      await app.model.Game.update({
        roomId: roomId
      }, {
        userNum: Number(roomInfo.userNum) + 1,
        $addToSet: {
          players: {
            userId: botInfo.id,
            username: botInfo.username,
            money: Number(roomInfo.initMoney),
            color: color,
            status: 'normal',
            rank: 0
          }
        }
      });

      const nsp = app.io.of('/');

      nsp.emit(roomId + '-joinRoomBack', {
        user: botInfo,
        type: 'join'
      });
    } catch (error) {
      app.logger.error(error);
    }
  }
};

/**
 * 计算不动产
 * @param {*} areas 全部地区信息
 * @param {*} userId 用户id
 */
function calcHouseMoey(areas, userId) {
  let money = 0;
  for (let i in areas) {
    if (areas[i].owner == userId && areas[i].type == 'place') {
      money += areas[i].price + areas[i].upgradePrice * (Number(areas[i].rank) - 1);
    }
  }

  return money;
}

/**
 * 倒计时
 */
async function countDown(countDown, orderId, userId, roomId, nextPlayer, afterRound, app, callback) {
  // 推送够买升级倒计时
  // 标识倒计时，用来消除倒计时
  await app.redis.set(orderId, false);
  console.log(countDown+"countdown")
  app.redis.expire(orderId, countDown + 10);
  const nsp = app.io.of('/');
  // 每秒减一
  let timer = setInterval(async () => {
    // 已处理过则不再计时，清空计时器（已够买或取消够买）
    let isProcessed = await app.redis.get(orderId);
    if (isProcessed == 'false') {
      nsp.emit(roomId + '-countDown', {
        _id: userId,
        countDown: countDown
      });
      countDown -= 1;

      if (countDown < 0 && await app.redis.exists(roomId)) {
        clearInterval(timer);
        app.redis.hmset(roomId, {
          currentRound: afterRound
        });
        nsp.emit(roomId + '-currentRound', {
          _id: userId,
          nextPlayer: nextPlayer
        });
        if (callback) {
          callback();
        }
      }
    } else {
      clearInterval(timer);
    }
  }, 1000);
}
