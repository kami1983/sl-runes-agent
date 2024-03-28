import { Telegraf } from "telegraf";
import { message, callbackQuery } from 'telegraf/filters';
import { Principal } from '@dfinity/principal';
import type { ActorSubclass } from "@dfinity/agent";
import { table, getBorderCharacters } from "table";

import { createActor } from './declarations/rbot_backend';
import { RedEnvelope } from "./declarations/rbot_backend/rbot_backend.did";
import { _SERVICE } from "./declarations/rbot_backend/rbot_backend.did";
import * as C from './constants'
import { makeAgent } from '../../utils'
import { getAgentIdentity, getUserIdentity, hasUserIdentity } from '../../identity'
import { createPool, getTokens, getTokenBySymbol, getTokenBycanister } from '../../tokens'
import { icrc1BalanceOf, icrc1Transfer } from "../ledger/ledger";

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const CANISTER_ID = process.env.RBOT_CANISTER_ID || ""
const BOT_TOKEN = process.env.RBOT_BOT_TOKEN || ""
const WEBHOOK_PATH = process.env.RBOT_WEBHOOK_PATH || ""
const SECRET_TOKEN = process.env.RBOT_SECRET_TOKEN || ""

const bot = new Telegraf(BOT_TOKEN);

bot.on(message('text'), async ctx => {
  ctx.telegram.webhookReply = true
  const chatId = ctx.message.chat.id
  const userId = ctx.message.from.id;
  const text = ctx.message.text

  if (text && text.startsWith('/')) {
    const [cmd, ...args] = text.split(' ');
    // Ensure wallet address
    const walletCmds = ['/balance', '/address', '/transfer']
    const reCmds = ['/listre', '/createre', '/sendre', '/grabre']
    if ((walletCmds.includes(cmd) || reCmds.includes(cmd)) && !hasUserIdentity(userId)) {
      const principal = getUserIdentity(userId).getPrincipal().toText()
      ctx.reply(`Wallet address: ${principal}`)
      return
    }
    // Process command
    switch (cmd) {
      case '/start':
        if (chatId > 0) {
          ctx.replyWithHTML(C.RBOT_START_IN_PRIVATE_MESSAGE, { reply_markup: C.RBOT_START_IN_PRIVATE_KEYBOARD })
        } else if (chatId < 0) {
          ctx.replyWithHTML(C.RBOT_START_IN_GROUP_MESSAGE, { reply_markup: C.RBOT_START_IN_GROUP_KEYBOARD })
        } else {
          ctx.reply('Welcome to rbot!')
        }
        break;
      case '/help':
        ctx.replyWithHTML(C.RBOT_HELP_MESSAGE)
        break;
      // reapp commands
      case '/icreated':
        ctx.reply(await listRedEnvelope(userId))
        break;
      case '/redenvelope':
        ctx.replyWithHTML(await showRedEnvelope(userId, args))
        break;
      case '/create':
        ctx.reply(await createRedEnvelope(userId, args))
        break;
      case '/send':
        if (args.length !== 1) {
          ctx.reply(`Invalid input: ${text}`)
          return
        }
        // TODO: call re_app send_re
        ctx.reply(`call re_app send_re`)
        break;
      case '/grab':
        ctx.reply(await grabRedEnvelope(userId, args))
        break;
      case '/revoke':
        ctx.reply(await revokeRedEnvelope(userId, args))
        break;
      // wallet commands
      case '/address':
        ctx.reply(await getAddress(userId))
        break
      case '/balance':
        ctx.replyWithHTML(await getBalance(userId))
        break
      case '/transfer': {
        ctx.reply(await transferToken(userId, args))
        break
      }
      default:
        ctx.reply('Invalid command. Type /help to see the available commands.')
    }
  } else {
    ctx.reply(ctx.message.text)
  }
});

bot.on(callbackQuery("data"), async ctx => {
  const data = ctx.callbackQuery.data
  const userId = ctx.callbackQuery.from.id
  switch (data) {
    case 'showAddress':
      ctx.reply(await getAddress(userId))
      break;
    case 'showBalance':
      ctx.replyWithHTML(await getBalance(userId))
      break;
    case 'showHowToTransfer':
      ctx.reply(C.RBOT_HOW_TO_TRANSFER_MESSAGE)
      break;
    case 'showHowToCreateARedEnvelope':
      ctx.reply(C.RBOT_HOW_TO_CREATE_RED_ENVELOPE)
      break;
    case 'showRedEnvelopesYouCreated':
      ctx.reply(await listRedEnvelope(userId))
      break;
    case 'showCommandList':
      ctx.replyWithHTML(C.RBOT_HELP_MESSAGE)
      break;
    default:
      break;
  }
})

export const callback = bot.webhookCallback(WEBHOOK_PATH, { secretToken: SECRET_TOKEN })


async function getAgentActor(): Promise<ActorSubclass<_SERVICE>> {
  const identity = getAgentIdentity();
  const agent = await makeAgent({ fetch, identity })
  return createActor(CANISTER_ID, { agent })
}

async function createRedEnvelope(userId: number, args: string[]) : Promise<string> {
  if (args.length !== 3) {
    return 'Invalid input\n\n/create [Symbol] [Amout] [Count]'
  }
  try {
    typeof BigInt(args[1]) === 'bigint'
  } catch (error) {
    return 'Invalid [Amout]\n/create [Symbol] [Amout] [Count]'
  }
  const count = parseInt(args[2], 10);
  if (isNaN(count) || String(count) !== args[2]) {
    return 'Invalid [Count]\n/create [Symbol] [Amout] [Count]'
  }
  const token = await getTokenBySymbol(await createPool(), args[0])
  if (!token) {
    return 'Invalid [Symbol]\n/create [Symbol] [Amout] [Count]'
  }
  const amout = BigInt(args[1])
  if (amout > token.re_maximum || amout < token.re_minimum) {
    return 'Invalid [Symbol]\n/create [Symbol] [Amout] [Count]'
  }

  // TODO: Approve to agent, transfer_from to re_app & fee_address
  const fee_amount = amout * BigInt(token.fee_ratio) / 100n
  const re_amount = amout - fee_amount
  let ret = await icrc1Transfer(token, userId, re_amount, Principal.fromText(CANISTER_ID))
  if ('Err' in ret) {
    return `Transfer error: ${ret['Err']}`
  }
  ret = await icrc1Transfer(token, userId, fee_amount, Principal.fromText(token.fee_address))
  if ('Err' in ret) {
    return `Transfer error: ${ret['Err']}`
  }

  const serviceActor = await getAgentActor()
  const re: RedEnvelope = {
    num: count,
    status: 0,
    participants: [],
    token_id: Principal.fromText(token.canister),
    owner: getUserIdentity(userId).getPrincipal(),
    memo: 'test memo',
    is_random: true,
    amount: re_amount,
    expires_at:[]
  }
  const ret2 = await serviceActor.create_red_envelope(re)
  if ('Err' in ret2) {
    return `Create red envelope error: ${ret2['Err']}`
  } else {
    return `Red envelope id: ${ret2['Ok']}`
  }
}

async function grabRedEnvelope(userId: number, args: string[]) : Promise<string> {
  if (args.length !== 1) {
    return '/grab [RedEnvelopeID]'
  }
  try {
    typeof BigInt(args[0]) === 'bigint'
  } catch (error) {
    return '/grab [RedEnvelopeID]'
  }

  const userIdentity = getUserIdentity(userId)
  const serviceActor = await getAgentActor()
  const ret = await serviceActor.open_red_envelope(BigInt(args[0]), userIdentity.getPrincipal())
  if ('Err' in ret) {
    return `Grab red envelope error: ${ret['Err']}`
  } else {
    return `Grab amount: ${ret['Ok']}`
  }
}

async function revokeRedEnvelope(userId: number, args: string[]) : Promise<string> {
  if (args.length !== 1) {
    return '/revoke [RedEnvelopeID]'
  }
  try {
    typeof BigInt(args[0]) === 'bigint'
  } catch (error) {
    return '/revoke [RedEnvelopeID]'
  }

  const userIdentity = getUserIdentity(userId)
  const serviceActor = await getAgentActor()
  const ret = await serviceActor.revoke_red_envelope(BigInt(args[0]), /* TODO: userIdentity.getPrincipal()*/)
  if ('Err' in ret) {
    return `Revoke red envelope error: ${ret['Err']}`
  } else {
    return `Revoke amount: ${ret['Ok']}`
  }
}
async function listRedEnvelope(userId: number) {
  const userIdentity = getUserIdentity(userId)
  const serviceActor = await getAgentActor()
  const ret = await serviceActor.get_rids_by_owner(userIdentity.getPrincipal())
  return `Red envelopes: ${ret.map((v) => v.toString()).join(', ')}`
}

async function showRedEnvelope(userId: number, args: string[]) : Promise<string> {
  if (args.length !== 1) {
    return '/redenvelope [RedEnvelopeID]'
  }
  try {
    typeof BigInt(args[0]) === 'bigint'
  } catch (error) {
    return '/redenvelope [RedEnvelopeID]'
  }

  // const userIdentity = getUserIdentity(userId)
  const serviceActor = await getAgentActor()
  const ret = await serviceActor.get_red_envelope(BigInt(args[0]))
  if (ret.length) {
    const token = await getTokenBycanister(await createPool(), ret[0].token_id.toText())
    const details = [
      ['Token', token ? token.symbol:""],
      ['Amount', ret[0].amount],
      ['Count', ret[0].num],
      ['Random', ret[0].is_random? 'Y' : 'N'],
      ['Memo', ret[0].memo],
      // ['Owner', ],
      // ['participants', ]
    ]
    const tableString = table(details, {
      border: getBorderCharacters('ramac'),
    })
    return "<pre>" + tableString + "</pre>"
  } else {
    return 'Red envelope does not exist'
  }
}

async function getAddress(userId: number): Promise<string> {
  const address = getUserIdentity(userId).getPrincipal().toText()
  return `Wallet address:\n ${address}`
}

async function getBalance(userId: number): Promise<string> {
  const tokens = await getTokens(await createPool());
  const balances = await Promise.all(tokens.map(async (token) => ([
    token.symbol,
    (await icrc1BalanceOf(token, userId)).toString()
  ])));
  balances.unshift(['Token', 'Amount']);
  const tableString = table(balances, {
    singleLine: true,
    border: getBorderCharacters('ramac'),
  })
  return "<pre>" + tableString + "</pre>"
}

async function transferToken(userId: number, args: string[]) {
  if (args.length !== 3) {
    return '/transfer [Symbol] [Amout] [To]'
  }
  try {
    typeof BigInt(args[1]) === 'bigint'
  } catch (error) {
    return '/transfer [Symbol] [Amout] [To]'
  }
  const token = await getTokenBySymbol(await createPool(), args[0])
  if (!token) {
    return '/transfer [Symbol] [Amout] [To]'
  }
  const to = Principal.fromText(args[2])
  if (!to._isPrincipal) {
    return '/transfer [Symbol] [Amout] [To]'
  }

  const ret = await icrc1Transfer(token, userId, BigInt(args[1]), to)
  if ('Err' in ret) {
    return `Transfer error: ${ret['Err']}`
  } else {
    return `Transfer ${args[1]} ${args[0]} to ${args[2]}`
  }
}