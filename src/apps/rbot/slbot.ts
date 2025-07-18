// import { Telegraf, Context, Markup } from "telegraf"
// import { message } from 'telegraf/filters';
import { TFunction } from "i18next"
import { Principal } from '@dfinity/principal'
import jwt from 'jsonwebtoken';
import express, { Request, Response, NextFunction } from 'express';

// import { getUserIdentity } from '../../identity'
import { createPool } from '../../tokens'
// import { getSwapPrice, doSwap } from './rbot_swap';
// import { showWallet, transferToken } from './rbot_wallet'
// import { createRedEnvelope, sendRedEnvelope, grabRedEnvelope, revokeRedEnvelope, listRedEnvelope, showRedEnvelope, isRedEnvelopeEmpty, errorWithRedEnvelopeId } from './rbot_re'
import i18next, { I18nContext, getLanguage, setLanguage } from "./i18n"
import { ResultWalletInfos, showWallet, transferToken } from './rbot_wallet_json';
import { createRedEnvelope, getRedEnvelope, grabRedEnvelope, isAgentAcc, listRedEnvelope, revokeRedEnvelope } from "./rbot_re_json";
import { getAgentIdentity, getUserIdentity, delegateIdentity, uuidToNumber } from '../../identity'

import { llMD5String } from '../../utils'

import Knex from 'knex';

import * as S from "./status"

import { aesEncrypt, aesDecrypt } from '../../utils/crypto';

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}
// const debug = require('debug')('socialfi-agent:rbot')

const BOT_TOKEN = process.env.RBOT_BOT_TOKEN || ""
const BOT_USERNAME = process.env.RBOT_BOT_USERNAME || ""
const WEBHOOK_PATH = process.env.RBOT_WEBHOOK_PATH || ""
const SECRET_TOKEN = process.env.RBOT_SECRET_TOKEN || ""
const RE_START_PICTURE = 'https://storage.googleapis.com/socialfi-agent/rebot/snatch.jpg'
const RE_SNATCH_PICTURE = 'https://storage.googleapis.com/socialfi-agent/rebot/snatch.jpg'
const JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || ''
const APP_MODE = process.env.APP_MODE || 'prod'

const i18nTF = i18next.getFixedT('en')
function getI18n(): TFunction {
  return i18nTF
}

export const slCallback = async (req: Request, res: Response, next: NextFunction) => {

  console.log(req.path)

  // if(!checkToken(req)) {
  //   res.status(401).send('Unauthorized user');
  //   return;
  // }

  const _checkAgent = () => {
    if(!checkIsAgent()){
      res.status(401).send('Unauthorized agent');
      return false;
    }
    return true
  }

  const _checkToken = () => {
    if(!checkToken(req)){
      res.status(401).send('Unauthorized user');
      return false;
    }
    return true
  }

  const { uid, username, tid, timestamp, token, slUid} = extractUser(req);
  await S.insertUser(await createPool(), {
    uid,
    username,
    uuid: slUid,
    principal: getUserIdentity(uid).getPrincipal().toText()
  })

  // console.log('uid:', uid, 'username:', username, 'slUid:', slUid, 'tid:', tid, 'timestamp:', timestamp)

  const jwtVerify = (token: string): jwt.JwtPayload | null  => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET_KEY) as jwt.JwtPayload;
      return decoded
    } catch (err) {
      console.log('Invalid token', {err});
      return null;  // Token 无效
    }
  }

  switch (req.path) {
    case '/sl/wallet':
      res.send([{get: req.query, post: req.body}, await actionSlWallet(tid, uid)]);
      break;
    case '/sl/create':
      if(_checkToken()){
        const ex_day = req.body.ex_day??7; // 默认7天
        console.log('ex_day:', ex_day, 'args:', req.body.args)
        res.send([{get: req.query, post: req.body}, await actionSlCreate(tid, uid, ex_day, req.body.args)]);
      }
      break;
    case '/sl/grab':
      if(_checkToken()){
        const rid = req.body.rid;
        res.send([{get: req.query, post: req.body}, await actionSlGrab(tid, uid, username, rid)]);
      }
      break;
    case '/sl/list':
      if(_checkToken()){
        res.send([{get: req.query, post: req.body}, await actionSlList(uid, req.body.args, req.body.share_count)]);
      }
      break;
    case '/sl/get':
      if(_checkToken()){
        res.send([{get: req.query, post: req.body}, await actionSlGetRe(req.body.args)]);
      }
      break;
    case '/sl/get_return_uuid':
      if(_checkToken()){
        res.send([{get: req.query, post: req.body}, await actionSlGetReWithUuid(req.body.args)]);
      }
      break;
    case '/sl/transfer':
      if(_checkToken()){
        res.send([{get: req.query, post: req.body}, await actionSlTransfer(tid, uid, req.body.args)]);
      }
      break;
    // case '/sl/transfer2uid':
    //   if(_checkToken()){
    //     res.send([{get: req.query, post: req.body}, await actionSlTransfer2Uid(tid, uid, req.body.args)]);
    //   }
    //   break;
    case '/sl/transfer2avatar':
        if(_checkToken()){
          // req.body.args = '0.001 21387b74-a76d-4d28-9e8d-a5de47858315'
          // 首先 21387b74-a76d-4d28-9e8d-a5de47858315 可以转换成 uid 
          // 然后 uid 转换成 principal
          const to_uid = uuidToNumber(req.body.args.split(' ')[1]);
          const to_principal = getUserIdentity(to_uid).getPrincipal();
          console.log('to_uid:', to_uid, 'to_principal:', to_principal.toText())
          const to_args = `${req.body.args.split(' ')[0]} ${to_principal.toText()}`
          console.log('to_to_args:', to_args)
          res.send([{get: req.query, post: req.body}, await actionSlTransfer(tid, uid, to_args)]);
        }
        break;
    case '/sl/restats/list':
      if(_checkToken()){
        const page = req.body.page??0;
        const size = req.body.size??10;

        let owner = req.body.uid;
        // console.log('DEBUG restats/list :', {page, size, owner});
        if(owner != undefined){
          const userid = uuidToNumber(owner);
          owner = getUserIdentity(userid).getPrincipal()
        }else{
          owner = null;
        }
        res.send([{get: req.query, post: req.body}, await actionGetStatsList(tid, page, size, owner)]);
      }
      break;
    case '/sl/restats/buy/list':
      if(_checkToken()){
        const page = req.body.page??0;
        const size = req.body.size??10;
        let recipient = req.body.recipient;
        if(recipient != undefined){
          const userid = uuidToNumber(recipient);
          recipient = getUserIdentity(userid).getPrincipal()
        }else{
          recipient = null;
        }
        res.send([{get: req.query, post: req.body}, await actionGetStatsListByRecipient(tid, page, size, recipient)]);
      }
      break;
    case '/sl/location/insert':
      console.log('req.body: insert : ', req.body)
      const location = req.body.location;
      const status = req.body.status;
      if(location !== undefined && location != '' && status !== undefined && status != '') {
        res.send([{get: req.query, post: req.body}, await actionLocationInsert({rid: req.body.rid, location, status})]);
      }else{
        res.send([{get: req.query, post: req.body}, {status: 'error', message: 'invalid location or status'}])
      }
      
      break;
    case '/sl/location/delete':
      res.send([{get: req.query, post: req.body}, await actionLocationDelete(req.body.rid)]);
      break;
    case '/sl/location/list':
      const minutes = req.body.minutes;
      res.send([{get: req.query, post: req.body}, await actionLocationList(minutes)]);
      break;
    case '/sl/global/keys/update':
      if(_checkToken()){
        res.send([{get: req.query, post: req.body}, await actionUpdateGlobalKeys(Object.entries(req.body) as [string, string][])]);
      }else{
        res.status(401).send('Unauthorized user');
      }
      break;
    case '/sl/global/keys/get':
      // Get post data of keys
      const keys = (req.body.keys??'').split(',');
      res.send([{get: req.query, post: req.body}, await actionGetGlobalKeys(keys)]);
      break;
    case '/sl/revoke/re':
      res.send([{get: req.query, post: req.body}, await actionRevokeRedEnvelope(uid, req.body.rid)]);
      break;
    case '/sl/jwt_verify':

      res.send(jwtVerify(req.body.token));
      break;
    case '/sl/jwt_sign':
      res.send(jwt.sign({uid: uid}, JWT_SECRET_KEY, {expiresIn: '1h'}));
      break;
    case '/version':
      res.send({version: '1.3.0'});
      break;
    case '/sl/gettoken':
      // if(APP_MODE == 'test' || APP_MODE == 'dev'){
        console.log('Evn APP_MODE:', APP_MODE);
        const md5 = require('md5');
        const now = req.query.timestamp??Math.floor(new Date().getTime()/1000);

        res.send({token: llMD5String( `${slUid}${now}${JWT_SECRET_KEY}`,0), uid, timestamp: now, 'YZ2': llMD5String('11386b74-a76d-4d28-9e8d-a5de478583151735043675TEST-ATOCHA-WNXKFKAKDKFKSDFDKSNNGKDSFKDSAAFNDSDFSDF',0 )});
      // }
      break;
    case '/sl/testtoken':
      if(_checkToken()){
        res.send({get: req.query, post: req.body});
      }
      break;
    // case '/sl/user/get':
    //   if(_checkToken()){
    //     const uuid = req.query.uuid?.toString();
    //     if (!uuid) {
    //       res.status(400).send('Missing uuid parameter');
    //       return;
    //     }
    //     const user = await S.getUserByUuid(await createPool(), uuid);
    //     res.send({status: 'ok', user});
    //   }
    //   break;
    case '/sl/user/get_by_uuid':
      if(_checkToken()){
        const query_uid = req.query.query_uid?.toString()??'';
        if(query_uid == ''){
          res.status(400).send('Missing query_uid parameter');
          return;
        }
        const user = await S.getUserByUid(await createPool(), uuidToNumber(query_uid));
        if(user == undefined){
          res.status(400).send('User not found');
          return;
        }
        res.send({status: 'ok', user});
      }
      break;
    case '/sl/user/list':
      if(_checkToken()){
        try {
          const [users, total] = await Promise.all([
            S.getAllUsers(await createPool()),
            S.getUserCount(await createPool())
          ]);
          res.send({
            status: 'ok', 
            total,
            data: users.map(user => ({
              uid: user.uid,
              username: user.username || '',
              update_time: user.update_time,
              principal: user.principal || getUserIdentity(user.uid).getPrincipal().toText()
            }))
          });
        } catch (error: any) {
          console.error('Get users error:', error);
          res.status(500).send(error.message || 'Failed to get users');
        }
      }
      break;
    case '/sl/encrypt':
      if(_checkToken()){
        const text = req.body.text?.toString();
        if (!text) {
          res.status(400).send('Missing text parameter');
          return;
        }
        try {
          const encrypted = aesEncrypt(text);
          res.send({status: 'ok', encrypted});
        } catch (error: any) {
          console.error('Encryption API error:', error);
          res.status(500).send(error.message || 'Encryption failed');
        }
      }
      break;
    case '/sl/decrypt':
      if(_checkToken()){
        const encrypted = req.body.encrypted?.toString();
        if (!encrypted) {
          res.status(400).send('Missing encrypted parameter');
          return;
        }
        try {
          const decrypted = aesDecrypt(encrypted);
          res.send({status: 'ok', decrypted});
        } catch (error) {
          res.status(500).send('Decryption failed');
        }
      }
      break;
    default:
      next();
  }

}

/**
 * /transfer 100 bc1qa3f4cmcmhze5nqsuanltf759mm9cfqd4wmls0w
 * /transfer 100 kqwog-a4rvg-b7zzv-4skt7-fzosi-gtaub-xdkpi-4ywbu-mz23j-rfvoq-sqe
 * 
 * /transfer ICP 100 kqwog-a4rvg-b7zzv-4skt7-fzosi-gtaub-xdkpi-4ywbu-mz23j-rfvoq-sqe
 * /transfer ICP 100 96427a419d7608353f7a1d0c5529218dbf695b803ddc4ddb1f78b654b06a0b35
 */
// export async function transferToken(userId: number, args: string[], i18n: TFunction): Promise<string> 
async function actionSlTransfer(tid: number, uid: number, args: string){
  console.log('actionSlTransfer params: ', args)
  return await transferToken(tid, uid, args.split(' '), getI18n())
}

// async function actionSlTransfer2Uid(tid: number, uid: number, args: string){
//   const amount = args.split(' ')[0];
//   const to_uid = args.split(' ')[1];
//   const to_principal = getUserIdentity(uuidToNumber(to_uid)).getPrincipal();
//   console.log('actionSlTransfer2Uid params to_uid:', to_uid, 'to_principal:', to_principal.toText())
//   return await transferToken(tid, uid, [amount, to_principal.toText()], getI18n())
// }

async function actionGetGlobalKeys(keys: []) {
  const res = await S.getGlobalKeys(await createPool(), keys)
  return {status: 'ok', res}
}

async function actionUpdateGlobalKeys(keys: [string, string][]) {
  const res = await S.updateGlobalKeys(await createPool(), keys)
  return {status: 'ok', res}
}

async function actionLocationInsert(params: {rid: number, location: string, status: number}) {
  await S.insertSlLocation(await createPool(), params)
  return {status: 'ok'}
}

async function actionLocationDelete(rid: number) {
  await S.deleteSlLocation(await createPool(), rid)
  return {status: 'ok'}
}

async function actionLocationList(minutes: number) {
    return await S.getSLLocationList(await createPool(), minutes)
}

async function actionGetStatsList(tid: number, page: number, size: number, owner: Principal | null) {
  return await S.getReStatusList(await createPool(), page, size, tid, owner)
}

async function actionGetStatsListByRecipient(tid: number, page: number, size: number, recipient: Principal) {
  return await S.getReStatusListByRecipient(await createPool(), page, size, tid, recipient)
}

async function actionSlWallet(tid: number, uid: number): Promise<ResultWalletInfos> {
  return await showWallet(tid, uid, getI18n())
}

async function actionSlCreate(tid: number, uid: number, ex_day: number, args: string): Promise<[string, object?, object?]>{
  try{
    return await createRedEnvelope(tid, uid, ex_day, args, getI18n())
  }catch(e){
    console.log('error:', e)
    return [(e as Error).message]
  }
}

async function actionSlGrab(tid: number, uid: number, username: string, rid: string){
  try{
    return {res: await grabRedEnvelope(tid, uid, username, [rid], getI18n()), username}
  }catch(e){
    console.log('error:', e)
    return {res: (e as Error).message}
  }
}

async function actionSlList(uid: number, args: string, share_count?: number){
  return await listRedEnvelope(uid, [args], getI18n(), share_count)
}

async function actionSlGetRe( args: string){
  try{
    const res = await getRedEnvelope([args], getI18n())
    return res
  }catch(e){
    console.log('error:', e)
    return (e as Error).message
  }
}

interface Participant {
  principal: string;
  nat: string;
}

interface RedEnvelopeResponse {
  rid: string;
  num: number;
  status: number;
  participants: Participant[];
  token_id: string;
  owner: string;
  memo: string;
  is_random: boolean;
  amount: string;
  expires_at: string;
  token_symbol: string;
  expand: {
    grab_amount: string;
    all_num: number;
    unreceived_amount: string;
    all_amount: string;
    participants_num: number;
  };
}

async function actionSlGetReWithUuid(args: string) {
  try {
    const res = await getRedEnvelope([args], getI18n()) as RedEnvelopeResponse;
    
    // 获取 owner 和 participants 中所有 principal 的 uuid
    const principalList = [res.owner];
    if (res.participants) {
      principalList.push(...res.participants.map(p => p.principal));
    }
    const uuidList = await S.getUuidByPrincipal(await createPool(), principalList);
    
    // 更新返回结果
    const modifiedRes = {
      ...res,
      owner: uuidList[0], // owner 的 uuid
      participants: res.participants?.map((p, index) => ({
        nat: p.nat,
        uuid: uuidList[index + 1] // participants 的 uuid，从 index 1 开始
      }))
    };
   
    return modifiedRes;
  } catch(e) {
    console.log('error:', e)
    return (e as Error).message
  }
}

async function checkIsAgent(): Promise<boolean> {
  const agentIdentity = getAgentIdentity().getPrincipal()
  // console.log('checkIsAgent:', agentIdentity.toText())
  const is_agent = await isAgentAcc(agentIdentity)
  return is_agent
}


function checkToken(req: Request): boolean {
  
  const { uid, username, tid, timestamp, token, slUid} = extractUser(req);
  // const token = req.query.token;
  // const timestamp = req.query.timestamp?.toString()??'';

  console.log('checkToken:', {uid, username, token, timestamp, slUid})

  if (uid <=0 || token === '' || timestamp === '') {
    return false;
  }

  if(APP_MODE !== 'test'){
    const now = Math.floor(new Date().getTime()/1000);
    console.log('Diff = now:', now, 'timestamp:', parseInt(timestamp))
    if (now - parseInt(timestamp) > 60) {
      return false;
    }

    const md5_token = llMD5String(`${slUid}${timestamp}${JWT_SECRET_KEY}`, 0);
    if(token !== md5_token){
      return false;
    }
  }
  
  return true
}

function extractUser(req: Request): { uid: number, username: string, tid: number, timestamp: string, token: string, slUid: string } {
  
  console.log('extractUser *** ', req.query);
  const slUid = req.query.uid?.toString()??'NONE';
  const uid = uuidToNumber(req.query.uid?.toString()??'0');
  const username = req.query.username?.toString()??'';
  const tid = parseInt( req.query.tid?.toString()??'0');
  const timestamp = req.query.timestamp?.toString()??'';
  const token = req.query.token?.toString()??'';
  console.log('extractUser:', {uid, username, tid, timestamp, token})
  return { uid, username, tid, timestamp, token, slUid }
}

async function actionRevokeRedEnvelope(uid: number, rid: number): Promise<string> {
  try {
    return revokeRedEnvelope(uid, rid, getI18n());
  } catch (e) {
    console.log('error:', e)
    return (e as Error).message
  }
}

// const app = express();

// app.get('/functionOne', (req, res) => {
//   res.send('This is function one');
// });

// app.get('/functionTwo', (req, res) => {
//   res.send('This is function two');
// });

// module.exports = app;pool: Knex.Knex, user: User, p0: unknownpool: Knex.Knex, user: User, p0: {}