require("dotenv").config()
const isDev = process.env.NODE_ENV === 'development';

import * as LangEnUS from '../locales/en-US.json'
import * as LangZhCN from '../locales/zh-CN.json'
/**
 * multilingual 
 * @type key:value pair hashmap
 */
export const locales = {
    "en-US": LangEnUS,
    // "zh-CN": LangZhCN,
} as { [lang: string]: { [key: string]: string } }

/**
 * default locale
 * @type string
 */
export const DefaultLocale = "en-US"

/**
 * http port
 * @type number
 */
export const PORT = Number(process.env.HTTP_PORT || 80);
export const REDIS_URL = process.env.REDIS_URL || '';
export const MONGO_URL = process.env.MONGO_URL || '';
export const TESTNET = process.env.TESTNET === '1';
export const SYMBOL = process.env.SYMBOL || '';
export const ZEROADDRESS = '0x0000000000000000000000000000000000000000';
export const MAXGASLIMIT = 1e5;
export const TIP = 100;

// https://rpc.ankr.com/eth_goerli	
export const RPC_URL = process.env.NODE_RPC;

export const ChainID = 5;
export const PRIVKEY = process.env.ADMIN_PRIVKEY || '';
export const SECRETKEY = process.env.SECKEY;
export const UNISWAP2_ROUTER_ADDRESS = process.env.UNISWAP2_ROUTER_ADDRESS;
export const UNISWAPV2_FACTORY_ADDRESS = process.env.UNISWAPV2_FACTORY_ADDRESS;




