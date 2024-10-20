import { HttpAgent, HttpAgentOptions } from '@dfinity/agent';
import dotenv from 'dotenv';
dotenv.config();

export const makeAgent = async (options?: HttpAgentOptions) => {
  const host = process.env.DFX_NETWORK === 'local' ? 'http://127.0.0.1:4943' : 'https://icp-api.io';
  const agent = new HttpAgent({
    host,
    // TODO - remove this when the dfx replica supports it
    verifyQuerySignatures: false,
    ...options,
  });
  try {
    await agent.fetchRootKey();
  } catch (_) {
    //
  }
  return agent;
};


const RBOT_TOKEN_SYMBOL_MAP: string[] = process.env.RBOT_TOKEN_SYMBOL_MAP?.split(',') || []
const RBOT_TOKEN_DECIMALS_MAP: number[] = process.env.RBOT_TOKEN_DECIMALS_MAP?.split(',').map(Number) || []
const RBOT_CANISTER_ID_MAP: string[] = process.env.RBOT_CANISTER_ID_MAP?.split(',') || []

export function getTokenSymbolByTid(tid: number): string | null {
  if (tid < RBOT_TOKEN_SYMBOL_MAP.length) {
    return RBOT_TOKEN_SYMBOL_MAP[tid]
  }
  return null
}

export function getTokenDecimalByTid(tid: number): number | null {
  if (tid < RBOT_TOKEN_DECIMALS_MAP.length) {
    return RBOT_TOKEN_DECIMALS_MAP[tid]
  }
  return null
}

export function getTokenTidBySymbol(symbol: string): number | null {
  return RBOT_TOKEN_SYMBOL_MAP.indexOf(symbol)
}

export function getCanisterIdBySymbol(symbol: string): string | null {
  if (RBOT_TOKEN_SYMBOL_MAP.includes(symbol)) {
    return RBOT_CANISTER_ID_MAP[RBOT_TOKEN_SYMBOL_MAP.indexOf(symbol)]
  }
  return null
}

export function getTidByCanisterId(canisterId: string): number | null {
  if (RBOT_CANISTER_ID_MAP.includes(canisterId)) {
    return RBOT_CANISTER_ID_MAP.indexOf(canisterId)
  }
  return null
}

