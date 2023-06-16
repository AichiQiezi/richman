'use strict';
const jwt = require('jsonwebtoken');

module.exports = (option, app) => {
    return async function tokenVerify(ctx, next) {
        try {
            if (app.config.jwt.whiteList.indexOf(ctx.req._parsedUrl.pathname) === -1) {
                if (!ctx.helper.isEmpty(ctx.headers.token) && ctx.headers.token !== 'undefined' && !ctx.helper.isEmpty(ctx.headers.token.trim())) {
                    const token = ctx.headers.token.trim()
                    let payload = await jwt.decode(token, app.config.secret);
                    console.log('pay: ', payload)
                    let tokenUserId = payload._id;
                    let userId = (await app.redis.hgetall(app.config.redis.prefix + 'token-' + token))._id;
                    if (!ctx.helper.isEmpty(userId)) {
                        if (userId === tokenUserId) {
                            // let auth = await authVerify(ctx, userId)
                            // if(auth.info.errno === app.config.result.SUCCESS.errno){
                            app.redis.expire(app.config.redis.prefix + 'token-' + token, app.config.jwt.token_expire);
                            ctx.state.userId = payload._id;
                            await next();
                            // }else {
                            //   ctx.body = auth.info;
                            //   ctx.body.data = auth.data;
                            //   return false;
                            // }
                        } else {
                            return ctx.body = app.config.result.TOKEN_INVALID;
                        }
                    } else {
                        return ctx.body = app.config.result.TOKEN_NOT_FOUND;
                    }
                } else {
                    return ctx.body = app.config.result.TOKEN_MISS;
                }
            } else {
                await next();
            }
        } catch (error) {
            ctx.logger.error(error);
            return ctx.body = app.config.result.TOKEN_INVALID
        }
    };
};
