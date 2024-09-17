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
