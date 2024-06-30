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

import { ResultWalletInfos, showWallet } from './rbot_wallet_json';
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

  const { uid, username } = extractUser(req);
  await S.insertUser(await createPool(), {
    uid,
    username,
  })

  console.log('uid:', uid, 'username:', username)

  switch (req.path) {
    case '/sl/wallet':
      res.send([{get: req.query, post: req.body}, await actionSlWallet(uid)]);
      break;
    case '/sl/create':
      if(_checkToken()){
        res.send([{get: req.query, post: req.body}, await actionSlCreate(uid, req.body.args)]);
      }
      break;
    case '/sl/grab':
      // if(_checkAgent()){
      //   const rid = req.body.rid;
      //   res.send(await actionSlGrab(uid, username, rid));
      // }
      if(_checkToken()){
        const rid = req.body.rid;
        res.send([{get: req.query, post: req.body}, await actionSlGrab(uid, username, rid)]);
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

async function actionSlWallet(uid: number): Promise<ResultWalletInfos> {
  return await showWallet(uid, getI18n())
}

async function actionSlCreate(uid: number, args: string){
  return await createRedEnvelope(uid, args, getI18n())
}

async function actionSlGrab(uid: number, username: string, rid: string){
  return {res: await grabRedEnvelope(uid, username, [rid], getI18n()), username}
}

async function actionSlList(uid: number, args: string, share_count?: number){
  return await listRedEnvelope(uid, [args], getI18n(), share_count)
}

async function actionSlGetRe(args: string){
  const res = await getRedEnvelope( [args], getI18n())
  console.log('res:', res)
  return res
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

function extractUser(req: Request): { uid: number, username: string } {
  const uid = uuidToNumber(req.query.uid?.toString()??'0');
  const username = req.query.username?.toString()??'';
  return { uid, username }
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