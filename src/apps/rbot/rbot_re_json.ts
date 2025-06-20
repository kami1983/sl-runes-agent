import { Markup } from "telegraf"
import { Principal } from '@dfinity/principal'
import type { ActorSubclass } from "@dfinity/agent"
import { table, getBorderCharacters } from "table"
import { TFunction } from "i18next"
import { join } from "path"
import sharp from 'sharp'
import { aesEncrypt, aesDecrypt } from '../../utils/crypto'

import { getTidByCanisterId, getTokenDecimalByTid, getTokenSymbolByTid, makeAgent } from '../../utils'
import { getAgentIdentity, getUserIdentity } from '../../identity'
import { createPool, getTokenBySymbol, getTokenBycanister } from '../../tokens'
import { icrc1BalanceOf, icrc1Transfer, icrc1Fee } from "../ledger/icrc1"
import { createActor } from './declarations/rbot_backend'
import { RedEnvelope } from "./declarations/rbot_backend/rbot_backend.did"
import { _SERVICE } from "./declarations/rbot_backend/rbot_backend.did"
import { stringToBigint, bigintToString } from './rbot_utils'
import * as S from "./status"
import { get } from "http"
import exp from "constants"


const RBOT_CANISTER_ID = process.env.RBOT_CANISTER_ID || ""
const RBOT_BOT_USERNAME = process.env.RBOT_BOT_USERNAME || ""
const TOKEN_SYMBOL = process.env.RBOT_TOKEN_SYMBOL || ""
const TOKEN_DECIMALS = process.env.RBOT_TOKEN_DECIMALS || "2"

export async function createRedEnvelope(tid: number, userId: number, ex_day: number, args: string, i18n: TFunction): Promise<[string, object?, object?]> {

  console.log('RUN - createRedEnvelope')
  const _token_symbol = getTokenSymbolByTid(tid)
  if (_token_symbol == null) {
    return [i18n('msg_how_to_create')]
  }

  const token = await getTokenBySymbol(await createPool(), _token_symbol)
  if (!token) {
    return [i18n('msg_how_to_create')]
  }

  if (args === null || args === undefined) {
    return [i18n('msg_how_to_create')]
  }

  const _decimal = getTokenDecimalByTid(tid)
  if(_decimal == null) {
    return [i18n('msg_how_to_create')]
  }

  /**
   * 88.88 5 F ababbaba
   * /^(\d+(?:\.\d{1,2})?)\s+(\d+)(?:\s+(F\b))?(?:\s+(.*))?$/
   * 
   * 88 5 F ababbaba
   * /^(\d+)\s+(\d+)(?:\s+(F\b))?(?:\s+(.*))?$/
   */
  let amountPattern = '\\d+(?:\\.\\d{1,' + _decimal.toString() + '})?';
  let creationPattern = '^(' + amountPattern + ')\\s+(\\d+)(?:\\s+(F\\b))?(?:\\s+(.*))?$';
  const pattern = new RegExp(creationPattern);
  // const pattern = /^(\d+)\s+(\d+)(?:\s+(F\b))?(?:\s+(.*))?$/
  const matches = args.trim().match(pattern)
  if (matches == null) {
    return [i18n('msg_how_to_create')]
  }

  // amount 88.88 -> 8888
  const raw_amount = matches[1]
  const amount = stringToBigint(raw_amount, _decimal)
  console.log('raw - amount:', {raw_amount, amount, _token_symbol, _decimal} )
  const count = parseInt(matches[2], 10);
  if (isNaN(count) || String(count) !== matches[2]) {
    return [i18n('msg_how_to_create')]
  }
  // amount <= 1000000.00 && count <=255 && each re minimum 
  if (amount > stringToBigint('100000', _decimal)) {
    return [i18n('msg_amount_maximum')]
  }
  if (count > 1000) {
    return [i18n('msg_count_maximum')]
  }
  if (amount / BigInt(count) < token.re_minimum_each) {
    return [i18n('msg_create_minimum', { amount: bigintToString(token.re_minimum_each, _decimal) })]
  }

  // out put time stamp
  console.log('Before transfer:', new Date().getTime())

  const random = (matches[3] === 'F') ? false : true
  const memo = matches[4] || ''
  // default: utc nanoseconds + 24hours
  const expires_at = BigInt((new Date()).getTime() + ((24 * ex_day) * 60 * 60 * 1000)) * 1000000n

  // 加密 memo
  const encrypted_memo = memo ? aesEncrypt(memo) : '';

  // TODO: Approve to agent, then transfer_from to re_app + fee_address
  const fee_amount = amount * BigInt(token.fee_ratio) / 100n
  const balance = await icrc1BalanceOf(token, userId)
  const transFee = await icrc1Fee(token, userId)
  const total = amount + fee_amount + transFee * 2n
  if (balance < total) {
    return [i18n('msg_create_insufficient', { amount: bigintToString(total, _decimal) })]
  }
  let ret = await icrc1Transfer(token, userId, amount, Principal.fromText(RBOT_CANISTER_ID))
  if ('Err' in ret) {
    return [i18n('msg_create_transfer_failed')] //TODO: `${ret['Err']}`
  }
  ret = await icrc1Transfer(token, userId, fee_amount, Principal.fromText(token.fee_address))
  if ('Err' in ret) {
    return [i18n('msg_create_transfer_failed')] //TODO: `${ret['Err']}`
  }

  // out put time stamp
  console.log('After transfer:', new Date().getTime())

  const serviceActor = await getAgentActor()
  
  const re: RedEnvelope = {
    num: count,
    status: 0,
    participants: [],
    token_id: Principal.fromText(token.canister),
    owner: getUserIdentity(userId).getPrincipal(),
    memo: encrypted_memo,
    is_random: random,
    amount: amount,
    expires_at: [expires_at]
  }

  // out put time stamp
  console.log('Before create_red_envelope:', new Date().getTime())
  
  const ret2 = await serviceActor.create_red_envelope2(re)
  console.log(ret2)

  // out put time stamp
  console.log('After create_red_envelope:', new Date().getTime())

  if ('Err' in ret2) {
    const code = `reapp_error_${ret2['Err'][0].toString()}`
    if (errorWithRedEnvelopeId(code)) {
      return [i18n(code, { id: '' })]
    } else {
      return [i18n(code)]
    }
  } else {
    const rid = ret2['Ok'][0]
    // assert((rid <= Number.MAX_SAFE_INTEGER && rid >= Number.MIN_SAFE_INTEGER), `Whoops ${rid} ...`)
    // insert db
    // console.log('Crewate Red Envelope:', {rid, amount, count, expires_at: expires_at.toString().substring(0,10), fee_amount, _token_symbol, userId, re})
    const reStatus = {
      id: parseInt(rid.toString()),
      rune: _token_symbol,
      uid: userId,
      amount,
      count,
      expire_at: expires_at.toString().substring(0,10) ,
      fee_amount,
      is_sent: false,
      is_revoked: false,
      owner: re.owner.toText(),
      token_id: re.token_id.toText(),
      is_random: re.is_random,
      memo: re.memo,
    }

    console.log('reStatus - ', reStatus)

    await S.insertReStatus(await createPool(), reStatus)
    // select user/group
    // const keyboard = RBOT_SELECT_USER_GROUP_KEYBOARD(Number(rid), count, i18n)
    const res_obj = {
      id: rid.toString(),
      fee: bigintToString(fee_amount, _decimal),
      icrc1_fee: bigintToString(transFee * 2n, _decimal),
    }
    return [i18n('msg_create', res_obj), {
      rid: res_obj.id,
      fee: res_obj.fee,
      count: count,
      amount: raw_amount,
      icrc1_fee: res_obj.icrc1_fee,
    }, {memo}]
  }
}

export async function sendRedEnvelope(userId: number, args: string[], i18n: TFunction): Promise<[string, object?]> {
  if (args.length !== 1) {
    return [i18n('msg_how_to_send')]
  }
  try {
    typeof BigInt(args[0]) === 'bigint'
  } catch (error) {
    return [i18n('msg_how_to_send')]
  }

  const pool = await createPool()
  const reStatus = await S.getReStatus(pool, parseInt(args[0]), userId)
  if (reStatus) {
    // [db] is_sent && is_revoked && expire
    if (reStatus.is_sent) {
      return [i18n('msg_send_repeat', { id: args[0] })]
    }
    if (reStatus.is_revoked) {
      return [i18n('reapp_error_1112', { id: args[0] })]
    }
    if (BigInt((new Date()).getTime()) * 1000000n > parseInt(reStatus.expire_at) ) {
      return [i18n('reapp_error_1107', { id: args[0] })]
    }
    // [canister] get re
    const serviceActor = await getAgentActor()
    const ret = await serviceActor.get_red_envelope(BigInt(args[0]))
    if (ret.length === 0) {
      return [i18n('reapp_error_1112', { id: args[0] })]
    }

    const keyboard = RBOT_SELECT_USER_GROUP_KEYBOARD(parseInt(args[0]), ret[0].num, i18n)
    return [i18n('msg_send'), keyboard]
  } else {
    return [i18n('reapp_error_1108', { id: args[0] })]
  }
}

export async function getRedEnvelope(args: string[], i18n: TFunction): Promise<object> {
  if (args.length !== 1) {
    return [i18n('msg_how_to_send')]
  }
  try {
    typeof BigInt(args[0]) === 'bigint'
  } catch (error) {
    return [i18n('msg_how_to_send')]
  }
  
  const serviceActor = await getAgentActor()
  const ret = await serviceActor.get_red_envelope2(BigInt(args[0]))
  console.log('getRedEnvelope', ret)
  if(ret.length === 0){
    return {}
  }

  const base_ret = ret[0][0]
  const expand_ret = ret[0][1]
  const token_id = base_ret.token_id.toText()
  const tid = getTidByCanisterId(token_id)
  if(tid == null){
    return [i18n('msg_tid_not_found')]
  }
  const _decimal = getTokenDecimalByTid(tid)
  if(_decimal == null){
    return [i18n('msg_decimal_not_found')]
  }

  console.log('Debug base_ret', {base_ret, expand_ret, _decimal})

  // 解密 memo，如果解密失败则使用原文
  let memo = base_ret.memo || '';
  if (memo) {
    try {
      memo = aesDecrypt(memo);
    } catch (error) {
      console.log('Memo decryption failed, using original text:', error);
      // 使用原文，不做任何处理
    }
  }

  return {
    rid: args[0],
    ...base_ret,
    participants: base_ret.participants.map((item: any) => {
      const returnItem = {
        principal: item[0].toText(),
        nat: bigintToString(item[1], _decimal),
      }
      return returnItem
    }),
    amount: bigintToString(base_ret.amount, _decimal),
    token_id: base_ret.token_id.toText(),
    token_symbol: getTokenSymbolByTid(getTidByCanisterId(base_ret.token_id.toText())??tid),
    owner: base_ret.owner.toText(),
    expires_at: base_ret.expires_at.toString().substring(0, 10),
    memo: memo,
    expand: {
      grab_amount: bigintToString(expand_ret.grab_amount, _decimal),
      all_num: expand_ret.all_num,
      unreceived_amount: bigintToString(expand_ret.unreceived_amount, _decimal),
      all_amount: bigintToString(expand_ret.all_amount, _decimal),
      participants_num: expand_ret.participants_num,
    }
  }
}

export async function grabRedEnvelope(tid: number, userId: number, username: string, args: string[], i18n: TFunction): Promise<[string, string, object?]> {
  
  const _decimal = getTokenDecimalByTid(tid)
  const _token_symbol = getTokenSymbolByTid(tid)

  if(_decimal == null || _token_symbol == null) {
    return ['tid error', 'Can not find token-symbol or token-decimal by tid']
  }
  
  const rid = parseInt(args[0]);
  const pool = await createPool()

  // create wallet with channel
  const userPrincipal = getUserIdentity(userId).getPrincipal()
  const wallet = { uid: userId, principal: userPrincipal.toText(), channel: rid }
  await S.insertWallet(pool, wallet)

  // insert snatch status
  await S.insertSnatchStatus(pool, { id: rid, uid: userId, code: -1, amount: 0n, discard: 0, recipient: userPrincipal.toText() })
  // snatch re
  const serviceActor = await getAgentActor()
  const ret = await serviceActor.open_red_envelope2(BigInt(args[0]), userPrincipal)
  console.log('--》 grabRedEnvelope', {ret, _decimal})
  if ('Err' in ret) {
    const snatchStatus = await S.getSnatchStatus(pool, rid, userId)
    if (snatchStatus && snatchStatus.code != 0) {
      await S.updateSnatchStatus(pool, { id: rid, uid: userId, code: Number(ret['Err'][0]), amount: 0n, discard: 0, recipient: userPrincipal.toText() })
    }
    const code = `reapp_error_${ret['Err'][0].toString()}`
    if (errorWithRedEnvelopeId(code)) {
      return [code, username + ' ' + i18n(code, { id: args[0] })]
    } else {
      return [code, username + ' ' + i18n(code)]
    }
  } else {
    // update snatch status
    await S.updateSnatchStatus(pool, { id: rid, uid: userId, code: 0, amount: ret['Ok'].grab_amount, discard: 0, recipient: userPrincipal.toText() })
    // amount 8888 -> 88.88
    const amount = bigintToString(ret['Ok'].grab_amount, _decimal)
    let msg = i18n('msg_snatch', { username, amount, id: args[0] })
    if (await S.getWallet(pool, userId) == undefined) {
      msg += '\n' + i18n('msg_snatch_suffix', { botname: RBOT_BOT_USERNAME })
    }
    return ['reapp_error_0', msg, {
      rid: rid,
      grab_amount: amount,
      participants_num: ret['Ok'].participants_num,
      all_num: ret['Ok'].all_num,
      all_amount:  bigintToString(ret['Ok'].all_amount, _decimal),
      unreceived_amount: bigintToString(ret['Ok'].unreceived_amount, _decimal),
      // expand: {
      //   grab_amount: amount,
      //   all_num: ret['Ok'].all_num,
      //   unreceived_amount: bigintToString(ret['Ok'].unreceived_amount, _decimal),
      //   all_amount: bigintToString(ret['Ok'].all_amount, _decimal),
      //   participants_num: ret['Ok'].participants_num,
      // }
    }]
  }
}

export async function revokeRedEnvelope(userId: number, rid: number, i18n: TFunction): Promise<string> {

  if(rid <= 0){
    return i18n('msg_how_to_revoke')
  }

  // is_revoked || expire_at
  const pool = await createPool()
  const reStatus = await S.getReStatus(pool, rid, userId)

  if (reStatus) {
    // [db] is_revoked && expire
    if (reStatus.is_revoked) {
      return i18n('reapp_error_1112', { id: rid })
    }
    console.log('Check expire_at:', BigInt((new Date()).getTime()) * 1000000n)
    if (BigInt((new Date()).getTime()) * 1000000n < Number(reStatus.expire_at)) {
      return i18n('reapp_error_1113', { id: rid })
    }

    const userIdentity = getUserIdentity(userId)
    const serviceActor = await getAgentActor()
    // console.log('BigInt(rid) = ', BigInt(rid))
    const ret = await serviceActor.revoke_red_envelope(BigInt(rid)) /* TODO: userIdentity.getPrincipal()*/
    // console.log('revokeRedEnvelope', {ret})
    if ('Err' in ret) {
      const code = `reapp_error_${ret['Err'][0].toString()}`
      if (errorWithRedEnvelopeId(code)) {
        return i18n(code, { id: rid })
      } else {
        return i18n(code)
      }
    } else {
      await S.updateReStatusIsRevoked(await createPool(), rid, true)
      return i18n('msg_revoke', { amount: bigintToString(ret['Ok'], parseInt(TOKEN_DECIMALS)) })
    }
  } else {
    return i18n('reapp_error_1108', { id: rid })
  }
}

export async function listRedEnvelope(userId: number, args: string[], i18n: TFunction, share_count?: number,) {
  const userIdentity = getUserIdentity(userId)
  const serviceActor = await getAgentActor()

  // console.log('check principal:', userIdentity.getPrincipal().toText())
  const rids = await serviceActor.get_rids_by_owner(userIdentity.getPrincipal())
  const getStatusFromCanister = async (rids: bigint[]) => {
    const status = await Promise.all(rids.map(async (rid) => {
      let amount = 0n
      let used = 0n
      let share_num = 0

      const ret = await serviceActor.get_red_envelope(BigInt(rid))
      
      if (ret[0]?.participants) {
        amount = ret[0].amount
        share_num = ret[0].num
        used = ret[0]?.participants.reduce((total, value) => total + value[1], BigInt(0))
      }
      return { rid, amount, used, share_num}
    }))
    return status
  }


  // page
  let page = 1
  const max = Math.ceil(rids.length / 20)
  if (args.length >= 1) {
    const num = parseInt(args[0])
    if (num > 0) {
      page = num
    }
    if (page > max) {
      page = max
    }
  }

  console.log('b.toString() = ', rids[0].toString(), 'a.toString() = ', rids[1].toString())
  // sort slice 
  const sorted = rids.sort((a, b) => parseInt(b.toString()) - parseInt(a.toString()))
  const startIndex = (page - 1) * 20
  const endIndex = page * 20
  const pageData = sorted.slice(startIndex, endIndex)
  const pageDataNumber = pageData.map(bigint => parseInt(bigint.toString()))
  // console.log('listRedEnvelope t1: ', (new Date()).toISOString())
  const scStatus = await getStatusFromCanister(rids)
  const dbStatus = await S.getReStatusByIds(await createPool(), pageDataNumber, userId, share_count)
  // console.log('listRedEnvelope t2: ', (new Date()).toISOString())
  const data: string[][] = []
  for (const id of pageDataNumber) {
    const scItem = scStatus.find(item => item.rid === BigInt(id))
    const dbItem = dbStatus.find(item => item.id === id)
    if (scItem) {
      const amount = scItem.amount
      const remain = scItem.amount - scItem.used
      const share_count = scItem.share_num
      let status = 'Unsent'
      if (dbItem) {
        if (dbItem.is_revoked) {
          status = 'Revoked'
        } else {
          // is_done
          if (BigInt((new Date()).getTime()) * 1000000n > BigInt(dbItem.expire_at)) {
            status = 'Expired'
          } else {
            if (dbItem.is_sent) {
              status = 'Sent'
            }
          }
        }
      }
      data.push([
        id.toString(),
        bigintToString(amount, parseInt(TOKEN_DECIMALS)),
        bigintToString(remain, parseInt(TOKEN_DECIMALS)),
        status,
        share_count.toString()
      ])
    }
  }
  // data.unshift(['No.', 'Amount', 'Left', 'Status']);
  return {page, max, data};
  // const tableString = table(data, { border: getBorderCharacters('ramac'), })
  // let htmlString = '<b>' + i18n('msg_my_re_title') + '</b>' + '\n'
  // htmlString += `<pre>${tableString}</pre>`
  // if (max > 1) {
  //   htmlString += `\n【${page}】/【${max}】`
  // }
  // return htmlString
}

export async function showRedEnvelope(userName: string, args: string[], i18n: TFunction): Promise<[string, string?, object?]> {
  const serviceActor = await getAgentActor()
  const ret = await serviceActor.get_red_envelope(BigInt(args[0]))
  if (ret.length) {
    const cover = await RBOT_REDENVELOPE_COVER(args[0], ret[0].amount, ret[0].num)
    let htmlString = '🧧🧧🧧 ' + i18n('from') + ' <b>' + userName + '</b>' + '\n'
    
    // 解密 memo，如果解密失败则使用原文
    let memo = ret[0].memo || '';
    if (memo) {
      try {
        memo = aesDecrypt(memo);
      } catch (error) {
        console.log('Memo decryption failed, using original text:', error);
        // 使用原文，不做任何处理
      }
    }
    htmlString += memo;
    
    const markup = { reply_markup: RBOT_REDENVELOPE_KEYBOARD(i18n, BigInt(args[0])) }
    return [htmlString, cover, markup]
  } else {
    return [i18n('reapp_error_1112', { id: args[0] })]
  }
}

export async function isRedEnvelopeEmpty(rid: bigint): Promise<boolean> {
  const serviceActor = await getAgentActor()
  const ret = await serviceActor.get_red_envelope(rid)
  return (ret.length && ret[0].participants.length == ret[0].num) ? true : false
}

// 
export async function isAgentAcc(agent_id: Principal): Promise<boolean> {
  const serviceActor = await getAgentActor()
  return await serviceActor.is_agent_acc(agent_id)
}



export function errorWithRedEnvelopeId(error: string): boolean {
  const errors: string[] = [
    'reapp_error_1107', 'reapp_error_1108', 'reapp_error_1109', 'reapp_error_1110',
    'reapp_error_1112', 'reapp_error_1113', 'reapp_error_1114'
  ];
  return errors.includes(error)
}

async function getAgentActor(): Promise<ActorSubclass<_SERVICE>> {
  const identity = getAgentIdentity();
  const agent = await makeAgent({ fetch, identity })
  return createActor(RBOT_CANISTER_ID, { agent })
}

const RBOT_REDENVELOPE_COVER = async (id: string, amount: bigint, count: number) => {
  // remove .00 & adjust font size
  let amountStr = bigintToString(amount, parseInt(TOKEN_DECIMALS))
  if (amountStr.endsWith('.00')) {
    amountStr = amountStr.slice(0, -3);
  }
  let size = 76
  if (amountStr.length > 6) {
    size -= 8 * Math.ceil((amountStr.length - 6) / 2)
  }
  const shares = count == 1 ? '1 Share' : `${count} Shares`
  // prepare svg
  const svg = Buffer.from(`
    <svg width="680" height="480" viewBox="0 0 680 480">
      <defs>
        <font-face font-family="ProductSansBold">
          <font-src>
            <font-face-uri href="https://storage.googleapis.com/socialfi-agent/rebot/ProductSans-Bold.ttf" />
          </font-src>
        </font-face>
        <font-face font-family="ProductSansRegular">
          <font-src>
            <font-face-uri href="https://storage.googleapis.com/socialfi-agent/rebot/ProductSans-Regular.ttf" />
          </font-src>
        </font-face>
      </defs>
      <text x="32" y="48" style="font-family: 'ProductSansRegular'; font-size: 32px; fill: #a6191b;" text-anchor="start" alignment-baseline="baseline">
        No.${id}
      </text>
      <text x="340" y="210" style="font-family: 'ProductSansBold'; font-size: ${size}px; fill: #fee499;" text-anchor="middle" alignment-baseline="central">
        ${amountStr}
      </text>
      <text x="340" y="280" style="font-family: 'ProductSansRegular'; font-size: 36px; fill: #fee499;" text-anchor="middle" alignment-baseline="central">
        ${shares}
      </text>
    </svg>
  `)
  const input = join(__dirname, 'static/RE02.jpg')
  const output = `/tmp/re_${id}.jpg`
  try {
    const image = sharp(input)
    const outputBuffer = await image.composite([{ input: svg }]).toBuffer()
    await sharp(outputBuffer).toFile(output)
    return output
  } catch (error) {
    console.error('Error adding text to image:', error)
    return input
  }
}

const RBOT_SELECT_USER_GROUP_KEYBOARD = (rid: number, count: number, i18n: TFunction) => {
  if (count == 1) {
    return Markup.keyboard([
      Markup.button.userRequest(i18n('btn_select_user'), rid + 1),
      Markup.button.groupRequest(i18n('btn_select_group'), rid),
    ]).oneTime().resize()
  } else {
    return Markup.keyboard([
      // TODO:
      Markup.button.userRequest(i18n('btn_select_user'), rid + 1),
      Markup.button.groupRequest(i18n('btn_select_group'), rid),
    ]).oneTime().resize()
  }
}

const RBOT_REDENVELOPE_KEYBOARD = (i18n: TFunction, rid: bigint) => {
  return {
    inline_keyboard: [
      [
        {
          text: i18n('btn_snatch'),
          callback_data: `claimRedEnvelope_${rid.toString()}_${RBOT_BOT_USERNAME}`
          // claimRedEnvelope_999_RE00bot
          // url: `https://t.me/${RBOT_BOT_USERNAME}?start=claimRedEnvelope_${rid.toString()}`
        },
      ]
    ]
  }
}
