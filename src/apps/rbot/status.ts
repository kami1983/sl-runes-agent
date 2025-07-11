import { number } from 'bitcoinjs-lib/src/script';
import Knex from 'knex';
import { getTidByCanisterId, getTokenDecimalByTid, getTokenSymbolByTid, getTokenTidBySymbol } from "../../utils"
import { bigintToString } from './rbot_utils';
import { stat } from 'fs';
import { Principal } from '@dfinity/principal';
import { aesDecrypt } from '../../utils/crypto';

/*
CREATE TABLE re_status(
    id bigint NOT NULL,
    rune text NOT NULL,
    uid bigint NOT NULL,
    amount text NOT NULL,
    count integer NOT NULL,
    expire_at text NOT NULL,
    fee_amount text NOT NULL,
    is_sent boolean DEFAULT false,
    is_revoked boolean DEFAULT false,
    is_done boolean DEFAULT false,
    receiver text,
    send_time timestamp without time zone,
    create_time timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    owner varchar(255),
    token_id varchar(255),
    is_random boolean,
    memo text,
    PRIMARY KEY(id)
);
CREATE INDEX re_status_send_time_idx ON re_status USING btree ("send_time");
*/
export interface ReStatus {
  id: number;
  rune: string,
  uid: number;
  amount: bigint;
  count: number;
  expire_at: string;
  fee_amount: bigint;
  is_sent?: boolean;
  is_revoked?: boolean;
  // is_done?: boolean;
  receiver?: string;
  send_time?: Date;
  create_time?: string;
  owner?: string;
  token_id?: string;
  is_random?: boolean;
  memo?: string;
  snatch_list?: ReStatusList[];
}

export interface ExpendReStatus extends ReStatus {
  friendly_amount: string|null;
  snatch_list_count: number;
}

export interface ReStatusList {
  id: number;
  uid: number;
  code: number;
  amount: string;
  discard: number;
  create_time: Date;
}

export const insertReStatus = async (pool: Knex.Knex, status: ReStatus) => {
  const { amount, expire_at, fee_amount, ...rest } = status;
  const modifiedStatus = {
    ...rest,
    amount: amount.toString(),
    expire_at: expire_at.toString(),
    fee_amount: fee_amount.toString(),
  };
  await pool('re_status')
    .insert({ ...modifiedStatus })
    .onConflict('id')
    .ignore();
}

export const updateReStatusIsSent = async (pool: Knex.Knex, id: number, is_sent: boolean) => {
  await pool('re_status')
    .where('id', id)
    .update({ is_sent })
}

export const updateReStatusIsRevoked = async (pool: Knex.Knex, id: number, is_revoked: boolean) => {
  await pool('re_status')
    .where('id', id)
    .update({ is_revoked })
}

// export const updateReStatusIsDone = async (pool: Knex.Knex, id: number, is_done: boolean) => {
//   await pool('re_status')
//     .where('id', id)
//     .update({ is_done })
// }

export const updateReStatusReceiver = async (pool: Knex.Knex, id: number, receiver: string) => {
  await pool('re_status')
    .where('id', id)
    .update({ is_sent: true, receiver })
    .update({ send_time: pool.fn.now() })
}

export const getReStatus = async (pool: Knex.Knex, id: number, uid: number) => {
  return await pool('re_status')
    .where('id', id)
    .andWhere('uid', uid)
    .first() as ReStatus | undefined
}

export const getReStatusListByRecipient = async (pool: Knex.Knex, page_start: number, page_size: number, tid: number, recipient: Principal): Promise<[string[], any[]]> => {
  // TODO::// 同样联合查询 snatch_status, re_status 表 检索 re_status，snatch_status.recipient=recipient
  // snatch_status.id = re_status.id 

  // 联合查询 snatch_status 和 re_status，拼接到一起
  let query = pool('snatch_status as s')
    .leftJoin('re_status as r', function () {
      this.on('r.id', '=', 's.id')
    })
    .where('s.recipient', recipient.toText())
    .orderBy('s.id', 'desc')
    .limit(page_size)
    .offset(page_start * page_size)
    .select('s.*', pool.raw('s.create_time as snatch_create_time'), 'r.*');

    const status_list = await query;
    console.log('status_list: ', status_list)

    // append a friendly_amount field to each object in status_list for displaying friendly amount
    const result = [];
    for (let i = 0; i < status_list.length; i++) {
      const item = status_list[i];
      const item_token_id = item.token_id;

      // 尝试解密 memo，如果解密失败则使用原文
      let decrypted_memo = item.memo || '';
      if (decrypted_memo) {
        try {
          decrypted_memo = aesDecrypt(decrypted_memo);
        } catch (error) {
          console.log('Memo decryption failed for id:', item.id, 'using original text:');
          // 使用原文，不做任何处理
        }
      }

      const result_item = {
        ...item,
        friendly_amount: null,
        // expire_at: item.expire_at.toString().substring(0, 10),
        create_time: (new Date(item.snatch_create_time??0).getTime()).toString().substring(0, 10),
        memo: decrypted_memo, // 使用解密后的 memo
      };
      if (item_token_id != null) {
        const item_tid = getTidByCanisterId(item_token_id);
        if(item_tid != null) {
          const item_decimal = getTokenDecimalByTid(item_tid);
          if(item_decimal != null) {
            result_item.friendly_amount = bigintToString(item.amount, item_decimal);
          }
        }
      }
      result.push(result_item);
    }

    const keys = [
      "id", "uid", "code", "amount", "discard", "create_time", 
      "recipient", "rune", "count", "expire_at", "fee_amount", 
      "is_sent", "is_revoked", "is_done", "receiver", "send_time", "owner", "token_id", "is_random", "memo", "friendly_amount"
    ]
    const values = []
    for (const idx in result) {
      const item = result[idx]
      let value = []
      for (const key of keys) {
        value.push(item[key])
      }
      values.push(value)
    }

    return [keys, values] as [string[], any[]];
}

export const getReStatusList = async (pool: Knex.Knex, page_start: number, page_size: number, tid: number, owner: Principal | null): Promise<[string[], any[]]> => {

  let token_symbol = null;
  if (tid>0) {
    token_symbol = getTokenSymbolByTid(tid);
  }

  // 获取 re_status id > 870 的数据
  let query = pool('re_status as r')
    .leftJoin('snatch_status as s', function () {
      this.on('s.id', '=', 'r.id').andOn('s.code', '=', pool.raw('?', [0]));
    })
    .where('r.id', '>', 870)
    .orderBy('r.id', 'desc')
    .limit(page_size)
    .offset(page_start * page_size)
    .select('r.*', pool.raw('json_agg(s.*) as snatch_list')) // 聚合 snatch_status 数据作为 snatch_list 字段
    .groupBy('r.id'); // 按照 re_status 的 id 分组

  if (token_symbol) {
    query = query.where('r.rune', token_symbol);
  }
  if(owner) {
    query = query.where('r.owner', owner.toText());
  }

  const status_list = await query as ReStatus[];
  const result: ExpendReStatus[] = [];
  // Loop through the data, the value of the field "rune" can be either ckBTC or ckUSDC, 
  // it needs to be converted into the corresponding tid, and then convert the "friendly_amount" field into its corresponding value.
  // It helps programmers to read the data firendly.
  for (let i = 0; i < status_list.length; i++) {
    const item = status_list[i];
    const item_token_id = item.token_id;

    // 整理一下item数据的snatch_list字段，去掉其中的null值
    if(item.snatch_list == null) {
      item.snatch_list = []
    }else if(item.snatch_list.length > 0) {
      for (let idx=0; idx<item.snatch_list.length; idx++) {
        if(item.snatch_list[idx] == null) {
          item.snatch_list.splice(idx, 1)
        }
      }
    }

    // 尝试解密 memo，如果解密失败则使用原文
    let decrypted_memo = item.memo || '';
    if (decrypted_memo) {
      try {
        decrypted_memo = aesDecrypt(decrypted_memo);
      } catch (error) {
        console.log('Memo decryption failed for id:', item.id, 'using original text:', error);
        // 使用原文，不做任何处理
      }
    }

    const result_item: ExpendReStatus = {
      ...item,
      friendly_amount: null,
      expire_at: item.expire_at.toString().substring(0, 10),
      create_time: (new Date(item.create_time??0).getTime()).toString().substring(0, 10),
      snatch_list_count: item.snatch_list?.length??0,
      memo: decrypted_memo, // 使用解密后的 memo
    };
    // console.log('DEBUG - item.snatch_list', item.snatch_list?.length, item.snatch_list,)
    if (item_token_id != null) {
      const item_tid = getTidByCanisterId(item_token_id);
      if(item_tid != null) {
        const item_decimal = getTokenDecimalByTid(item_tid);
        if(item_decimal != null) {
          result_item.friendly_amount = bigintToString(item.amount, item_decimal);
        }
      }
    }
    
    result.push(result_item);
  }

    const keys = [
      'id', 
      'rune', 
      'uid', 
      'amount', 
      'count', 
      'expire_at', 
      'fee_amount', 
      'is_sent', 
      'is_revoked', 
      'is_done',
      'receiver', 
      'send_time',
       'create_time', 
       'owner', 
       'token_id', 
       'is_random', 
       'memo', 
      //  'snatch_list', 
      'snatch_list_count',
       'friendly_amount'
    ]
    const values = []
    // while loop through the result, put the value of each object into values according to the order of keys
    for (const idx in result) {
      const item = result[idx]
      if(item.snatch_list == null) {
        item.snatch_list = []
      }
      // Remove null values from snatch_list
      for (let idx=0; idx<item.snatch_list.length; idx++) {
        if(item.snatch_list[idx] == null) {
          item.snatch_list.splice(idx, 1)
        }
      }

      let value = []
      for (const key of keys) {
        value.push(item[key as keyof ExpendReStatus])
      }
      values.push(value)
    }


  return [keys, values] as [string[], any[]];
};


export const getReStatusByIds = async (pool: Knex.Knex, ids: number[], uid: number, share_count?: number) => {
  
  if(share_count == undefined || share_count < 1) {
    share_count = share_count || 9999999
  }

  console.log('share_count: ', share_count)
  
  return await pool('re_status')
    .whereIn('id', ids)
    .andWhere('uid', uid)
    .andWhere('count', '<=', share_count)
    .orderBy('id', 'desc')
    .select() as ReStatus[]
}

export const getReCount = async (pool: Knex.Knex, duration?: number): Promise<number> => {
  let query = pool('re_status')
    .count<Record<string, number>>('id as count')
    .where('is_sent', true)

  if (duration) {
    const startTime = new Date((new Date()).getTime() - duration * 1000)
    query = query.where('send_time', '>=', startTime.toISOString())
  }

  const result = await query.first()
  return result?.count || 0
}

export const getReAmount = async (pool: Knex.Knex, duration?: number): Promise<string> => {
  let query = pool('re_status')
    .sum<Record<string, number>>({ sum: pool.raw('CAST(amount AS bigint)') })
    .where('is_sent', true)

  if (duration) {
    const startTime = new Date((new Date()).getTime() - duration * 1000)
    query = query.where('send_time', '>=', startTime.toISOString())
  }

  const result = await query.first()
  return result?.sum.toString() || '0'
}

/*
CREATE TABLE snatch_status (
  id bigint NOT NULL,
  uid bigint NOT NULL,
  code int8 DEFAULT -1 NOT NULL,
  amount text NOT NULL,
  discard int8 DEFAULT 0 NOT NULL,
  create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_id_uid UNIQUE (id, uid)
);
CREATE INDEX snatch_status_create_time_idx ON public.snatch_status (create_time);
*/
export interface SnatchStatus {
  id: number;
  uid: number;
  code: number;
  amount: bigint;
  discard: number;
  recipient: string;
  create_time?: Date;
}

export const insertSnatchStatus = async (pool: Knex.Knex, status: SnatchStatus) => {
  const { amount, ...rest } = status;
  const modifiedStatus = {
    ...rest,
    amount: amount.toString(),
  };
  // insertedCount ?
  await pool('snatch_status')
    .insert({ ...modifiedStatus })
    .onConflict(['id', 'uid'])
    .ignore();
}

export const getSnatchStatus = async (pool: Knex.Knex, id: number, uid: number) => {
  return await pool('snatch_status')
    .where({ id, uid })
    .first() as SnatchStatus | undefined
}

export const updateSnatchStatus = async (pool: Knex.Knex, status: SnatchStatus) => {
  const { amount, ...rest } = status;
  const modifiedStatus = {
    ...rest,
    amount: amount.toString(),
  };
  await pool('snatch_status')
    .insert({ ...modifiedStatus })
    .onConflict(['id', 'uid'])
    .merge({
      code: status.code,
      amount: status.amount,
      discard: status.discard,
    });
}

export const getSnatchCount = async (pool: Knex.Knex, duration?: number): Promise<number> => {
  let query = pool('snatch_status')
    .count<Record<string, number>>({ count: '*' })

  if (duration) {
    const startTime = new Date((new Date()).getTime() - duration * 1000)
    query = query.where('create_time', '>=', startTime.toISOString())
  }

  const result = await query.first()
  return result?.count || 0
}

/*
CREATE TABLE wallets (
  uid bigint PRIMARY KEY,
  principal TEXT NOT NULL,
  create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  channel bigint
);
CREATE INDEX wallets_create_time_idx ON public.wallets (create_time);
*/
export interface Wallet {
  uid: number;
  principal: string;
  create_time?: Date;
  channel?: number;
}

export const insertWallet = async (pool: Knex.Knex, wallet: Wallet) => {
  await pool('wallets')
    .insert({ ...wallet })
    .onConflict('uid')
    .merge({
      channel: pool.raw('COALESCE(wallets.channel, EXCLUDED.channel)'),
    })
    .whereNull('wallets.channel')
}

/**
 * CREATE TABLE sl_location(  
    id int NOT NULL PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    location TEXT NOT NULL,
    status int8 DEFAULT 0 NOT NULL,
    create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX sl_location_create_time_idx ON public.sl_location (create_time);
CREATE INDEX sl_location_update_time_idx ON public.sl_location (update_time);
 */
export interface SlLocation {
  id?: number;
  rid: number;
  location: string;
  status: number;
  create_time?: Date;
  update_time?: Date;
}

export const insertSlLocation = async (pool: Knex.Knex, location: SlLocation) => {
  return await pool('sl_location')
    .insert({ ...location })
    .onConflict('rid')
    .merge({
      location: pool.raw('EXCLUDED.location'),
      update_time: pool.raw('CURRENT_TIMESTAMP'),
      status: pool.raw('EXCLUDED.status'),
    });
}

// /* 数据表：
// CREATE TABLE table_name(  
//     id int NOT NULL PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
//     create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
//     update_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
//     name VARCHAR(255),
//     global_key VARCHAR(225) NOT NULL,
//     globle_value TEXT,
//     status int8 DEFAULT 0 NOT NULL,
//     UNIQUE (global_key)
// );
// */
// export const updateGlobalKeys = async (pool: Knex.Knex, keys: [string, string][]) => {
//   // keys = {key1: value1, key2: value2}
//   // 那么将会更新或插入两条记录
//   console.log('keys: ', keys)
//   let result = []
//   for (const idx in keys) {
//     console.log('key: ', keys[idx][0], ' value: ', keys[idx][1])
//     result.push(
//     await pool('global_vars')
//       .insert({
//         global_key: keys[idx][0],
//         global_value: keys[idx][1],
//       })
//       .onConflict('global_key')
//       .merge({
//         global_value: keys[idx][1],
//         update_time: pool.fn.now(),
//       }))
//   }
//   return result
// }

export const updateGlobalKeys = async (pool: Knex.Knex, keys: [string, string][]) => {
  console.log('keys: ', keys);

  return await pool.transaction(async (trx) => {
    let result = [];

    for (const [key, value] of keys) {
      console.log('key: ', key, ' value: ', value);

      // lock the row for update
      await trx('global_vars')
        .where('global_key', key)
        .forUpdate();

      result.push(
        await trx('global_vars')
          .insert({
            global_key: key,
            global_value: value,
          })
          .onConflict('global_key')
          .merge({
            global_value: value,
            update_time: trx.fn.now(),
          })
      );
    }

    return result;
  });
};

export const getGlobalKeys = async (pool: Knex.Knex, keys: []) => {
  let resmap: any = {}
  
  for (const idx in keys) {
    const key = keys[idx]
    const value = await pool('global_vars')
      .select('global_value')
      .where('global_key', key)
      .first()
    resmap[key] = value
  }
  return resmap
}

export const deleteSlLocation = async (pool: Knex.Knex, rid: number) => {
  await pool('sl_location')
    .where('rid', rid)
    .delete()
}

// 
export const getSLLocationList = async (pool: Knex.Knex, minutes: number): Promise<SlLocation[]> => {

  if( minutes == undefined || minutes < 1) {
    minutes = 600
  }

  const startTime = new Date((new Date()).getTime() - minutes * 60 * 1000)

  return await pool('sl_location')
    .column('rid', 'location', 'status')
    .where('update_time', '>=', startTime.toISOString())
    // 只返回 status > 0 的记录
    .andWhere('status', '>', 0)
    .orderBy('update_time', 'desc')
    .select() as SlLocation[]
}

export const getWallet = async (pool: Knex.Knex, uid: number) => {
  return await pool('wallets')
    .where({ uid })
    .first() as Wallet | undefined
}

export const getWalletCount = async (pool: Knex.Knex, duration?: number): Promise<number> => {
  let query = pool('wallets')
    .count<Record<string, number>>('uid as count')

  if (duration) {
    const startTime = new Date((new Date()).getTime() - duration * 1000)
    query = query.where('create_time', '>=', startTime.toISOString())
  }

  const result = await query.first()
  return result?.count || 0
}


/*
CREATE TABLE users (
  uid bigint PRIMARY KEY,
  username text,
  update_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
*/
export interface User {
  uid: number;
  username?: string;
  uuid?: string;
  principal?: string;
  update_time?: Date;
}

export const insertUser = async (pool: Knex.Knex, user: User) => {
  await pool('users')
    .insert({ ...user })
    .onConflict(['uid'])
    .merge({
      username: user.username,
      uuid: user.uuid,
      principal: user.principal,
      update_time: pool.fn.now(),
    });
}

export const getUserByUuid = async (pool: Knex.Knex, uuid: string): Promise<User | undefined> => {
  return await pool('users')
    .where('uuid', uuid)
    .first() as User | undefined;
}

export const getAllUsers = async (pool: Knex.Knex): Promise<User[]> => {
  return await pool('users')
    .select('uid', 'username', 'update_time', 'principal')
    .orderBy('update_time', 'desc') as User[];
}

export const getUserByUid = async (pool: Knex.Knex, uid: number): Promise<User | undefined> => {
  return await pool('users')
    .where('uid', uid)
    .first() as User | undefined;
}

export const getUuidByPrincipal = async (pool: Knex.Knex, principalList: string[]): Promise<string[]> => {
  const users = await pool('users')
    .whereIn('principal', principalList)
    .select('uuid', 'principal');
  
  // 保持返回顺序与输入顺序一致
  const uuidMap = new Map(users.map(u => [u.principal, u.uuid]));
  return principalList.map(p => uuidMap.get(p) || '');
}

export const getUserCount = async (pool: Knex.Knex): Promise<number> => {
  const result = await pool('users').count('uid as count').first();
  return result?.count as number || 0;
}

