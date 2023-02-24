require("dotenv").config()
const isDev = process.env.NODE_ENV === 'development';

import * as LangEnUS from '../locales/en-US.json'
import * as LangZhCN from '../locales/zh-CN.json'
import axios from 'axios';
/**
 * multilingual 
 * @type key:value pair hashmap
 */
export const locales = {
    "en-US": LangEnUS,
    // "zh-CN": LangZhCN,
} as { [lang: string]: { [key: string]: string } }
// //////////////////////////////
// const res = await axios.post(`${RPC_URL}`, json)
// const gasStationResponse = await fetch('https://gasstation-mumbai.matic.today/v2')
// const gasStationObj = JSON.parse(await gasStationResponse.text())
// let max_priority_fee = gasStationObj.standard.maxPriorityFee + EXTRA_TIP_FOR_MINER
// //////////////////////////////

// //////////////////////////////
// web3.eth.getMaxPriorityFeePerGas().then((f) => console.log("Geth estimate:  ", Number(f)));
// Geth estimate: 2375124957
// //////////////////////////////

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
export const TIP = Number(process.env.TIP);
export const EXTRA_TIP_FOR_MINER = Number(process.env.EXTRA_TIP_FOR_MINER)//  gwei 

// https://rpc.ankr.com/eth_goerli	
export const RPC_URL = process.env.NODE_RPC2;
export const ChainID = Number(process.env.CHAINID);
export const PRIVKEY = process.env.ADMIN_PRIVKEY || '';
export const SECRETKEY = process.env.SECKEY;
export const UNISWAP2_ROUTER_ADDRESS = process.env.UNISWAP2_ROUTER_ADDRESS;
export const UNISWAPV2_FACTORY_ADDRESS = process.env.UNISWAPV2_FACTORY_ADDRESS;




