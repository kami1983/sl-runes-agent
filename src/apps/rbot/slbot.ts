// import { Telegraf, Context, Markup } from "telegraf"
// import { message } from 'telegraf/filters';
import { TFunction } from "i18next"

// import { getUserIdentity } from '../../identity'
import { createPool } from '../../tokens'
// import { getSwapPrice, doSwap } from './rbot_swap';
// import { showWallet, transferToken } from './rbot_wallet'
// import { createRedEnvelope, sendRedEnvelope, grabRedEnvelope, revokeRedEnvelope, listRedEnvelope, showRedEnvelope, isRedEnvelopeEmpty, errorWithRedEnvelopeId } from './rbot_re'
import i18next, { I18nContext, getLanguage, setLanguage } from "./i18n"
import express, { Request, Response, NextFunction } from 'express';

import { ResultWalletInfos, showWallet, transferToken } from './rbot_wallet_json';
import { createRedEnvelope, getRedEnvelope, grabRedEnvelope, isAgentAcc, listRedEnvelope } from "./rbot_re_json";
import { getAgentIdentity, getUserIdentity, delegateIdentity, uuidToNumber } from '../../identity'

import Knex from 'knex';

import * as S from "./status"

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


import { Client } from 'pg';


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

  const { uid, username, tid } = extractUser(req);
  await S.insertUser(await createPool(), {
    uid,
    username,
  })

  console.log('uid:', uid, 'username:', username)

  switch (req.path) {
    case '/sl/wallet':
      res.send([{get: req.query, post: req.body}, await actionSlWallet(tid, uid)]);
      break;
    case '/sl/create':
      if(_checkToken()){
        res.send([{get: req.query, post: req.body}, await actionSlCreate(tid, uid, req.body.args)]);
      }
      break;
    case '/sl/grab':
      // if(_checkAgent()){
      //   const rid = req.body.rid;
      //   res.send(await actionSlGrab(uid, username, rid));
      // }
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
    case '/sl/transfer':
      if(_checkToken()){
        res.send([{get: req.query, post: req.body}, await actionSlTransfer(tid, uid, req.body.args)]);
      }
      break;
    case '/sl/restats/list':
      if(_checkToken()){
        const page = req.body.page??0;
        const size = req.body.size??10;
        res.send([{get: req.query, post: req.body}, await actionGetStatsList(tid, page, size)]);
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
      res.send([{get: req.query, post: req.body}, await actionUpdateGlobalKeys(Object.entries(req.body) as [string, string][])]);
      break;
    case '/sl/global/keys/get':
      // Get post data of keys
      const keys = (req.body.keys??'').split(',');
      res.send([{get: req.query, post: req.body}, await actionGetGlobalKeys(keys)]);
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
  console.log('args A: ', args)
  return await transferToken(tid, uid, args.split(' '), getI18n())
}

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

async function actionGetStatsList(tid: number, page: number, size: number) {
  return await S.getReStatusList(await createPool(), page, size, tid)
}

async function actionSlWallet(tid: number, uid: number): Promise<ResultWalletInfos> {
  return await showWallet(tid, uid, getI18n())
}

async function actionSlCreate(tid: number, uid: number, args: string): Promise<[string, object?, object?]>{
  try{
    return await createRedEnvelope(tid, uid, args, getI18n())
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

async function actionSlGetRe(args: string){
  try{
    const res = await getRedEnvelope( [args], getI18n())
    return res
  }catch(e){
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
  const uid = req.query.uid?.toString()??'' ;
  const username = req.query.username?.toString()??'';
  const token = req.query.token;
  const timestamp = req.query.timestamp;
  if (uid ==='' || username === '' || token === undefined || timestamp === undefined) {
    return false;
  }
  return true
}

function extractUser(req: Request): { uid: number, username: string, tid: number} {
  const uid = uuidToNumber(req.query.uid?.toString()??'0');
  const username = req.query.username?.toString()??'';
  const tid = parseInt( req.query.tid?.toString()??'0');
  console.log('extractUser:', {uid, username, tid})
  return { uid, username, tid }
}

// const express = require('express');
// const app = express();

// app.get('/functionOne', (req, res) => {
//   res.send('This is function one');
// });

// app.get('/functionTwo', (req, res) => {
//   res.send('This is function two');
// });

// module.exports = app;pool: Knex.Knex, user: User, p0: unknownpool: Knex.Knex, user: User, p0: {}