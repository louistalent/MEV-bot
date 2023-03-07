
// web router / rest & socket / RPC interface / session management

require("dotenv").config()
import * as express from 'express'
import Web3 from 'web3';
import fs from 'fs';

// import { parse as uuidParse } from 'uuid'
// import { now } from '@src/utils/helper'
// import cache from '../utils/cache'
// import { isValidCode } from '@src/utils/crc32'
import setlog from '../setlog'
import { BigNumber, ethers } from 'ethers'
import { now, Parse, Format, hexToDecimal } from '../utils/helper'
import axios from 'axios'
import { Prices } from '../Model'
import { MAXGASLIMIT, SYMBOL, ETHNETWORK, CHECKED, TESTNET, RPC_URL, TIP, RPC_URL2, BOTADDRESS, cronTime, UNISWAP2_ROUTER_ADDRESS, UNISWAPV2_FACTORY_ADDRESS, EXTRA_TIP_FOR_MINER } from '../constants'
import { inspect } from 'util'
import { isMainThread } from 'worker_threads';
import uniswapRouterABI from '../ABI/uniswapRouterABI.json';
import uniswapFactoryABI from '../ABI/uniswapFactoryABI.json';
import uniswapPairABI from '../ABI/uniswapPairABI.json';
import erc20ABI from '../ABI/erc20ABI.json';
import { Transaction } from 'mongodb';
import { sign } from 'crypto';
import approvedTokenListTestnet from "../constants/approvedTokenListTestnet.json";
import approvedTokenListMainnet from "../constants/approvedTokenListMainnet.json";
import { checkPrices } from "./checkPrice";

const approvedTokenList = TESTNET ? approvedTokenListTestnet as any : approvedTokenListMainnet as any;

const web3 = new Web3(RPC_URL)
const router = express.Router()
const prices = {} as { [coin: string]: number }
const gasPrices = {} as { [chain: string]: number };
const provider = new ethers.providers.JsonRpcProvider(RPC_URL)
const provider2 = new ethers.providers.JsonRpcProvider(RPC_URL2)
const wallet = new ethers.Wallet(BOTADDRESS, provider);
const signer = wallet.connect(provider);
const owner = wallet.address;

const Uniswap2Router = new ethers.Contract(UNISWAP2_ROUTER_ADDRESS, uniswapRouterABI, provider2);
const Uniswap2Factory = new ethers.Contract(UNISWAPV2_FACTORY_ADDRESS, uniswapFactoryABI, provider);

var signedUniswap2Router = Uniswap2Router.connect(signer);
var signedUniswap2Factory = Uniswap2Factory.connect(signer);
let scanedTransactions: any = [];
let nextBaseFee;

const SwapList = new ethers.utils.Interface([
	'function swapExactTokensForTokens( uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline )',
	'function swapTokensForExactTokens( uint amountOut, uint amountInMax, address[] calldata path, address to, uint deadline )',
	'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline)',
	'function swapTokensForExactETH(uint amountOut, uint amountInMax, address[] calldata path, address to, uint deadline)',
	'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline)',
	'function swapETHForExactTokens(uint amountOut, address[] calldata path, address to, uint deadline)',
	'function swapExactTokensForTokensSupportingFeeOnTransferTokens( uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline )',
	'function swapExactETHForTokensSupportingFeeOnTransferTokens( uint amountOutMin, address[] calldata path, address to, uint deadline )',
	'function swapExactTokensForETHSupportingFeeOnTransferTokens( uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline )',
])

const signedUniswap2Pair = async (pairContractAddress: string) => {
	const Uniswap2Pair = new ethers.Contract(pairContractAddress, uniswapPairABI, provider);
	return Uniswap2Pair
}

export const initApp = async () => {
	try {
		console.log("initialized Application");
		cron();
	} catch (error) {
	}
}
const checkActive = async () => {
	const balance = await provider.getBalance(wallet.address);
	let VALUE = ethers.utils.formatEther(balance);
	if (Number(VALUE) > ETHNETWORK || TESTNET) {
		return true;
	} else {
		return false;
	}
}
const cron = async () => {
	try {
		console.log(`start scanning`);
		await InspectMempool();
		await checkInspectedData()
	} catch (error) {
		console.log('cron', error);
	}
	setTimeout(() => {
		cron()
	}, cronTime);
}
const getDecimal = (tokenAddress: string) => {
	const tokens = approvedTokenList;
	const result = tokenAddress in tokens;
	if (result) {
		return tokens[`${tokenAddress}`].decimal;
	} else {
		return 18;
	}
}
const getSymbol = (tokenAddress: string) => {
	const tokens = approvedTokenList;
	const result = tokenAddress in tokens;
	if (result) {
		return tokens[`${tokenAddress}`].symbol;
	} else {
		return 'ETH';
	}
}
const getPendingTransaction = async () => {
	const rpc = async (json: any) => {
		const res = await axios.post(`${RPC_URL}`, json)
		return res.data.result;
	}
	try {
		let res = await rpc({ "jsonrpc": "2.0", "method": "txpool_content", "params": [], "id": 1 });
		return res;
	} catch (err) {
		console.log(err.message, err.stack)
	}
}
const calculateGasPrice = (action: any, amount: any) => {
	let number = parseInt(amount, 16);
	if (action === "buy") {
		return "0x" + (number + TIP).toString(16)
	} else {
		return "0x" + (number - 8).toString(16)
	}
}
const calculateETH = (gasLimit_: any, gasPrice: any) => {
	try {
		let TIP_ = TIP;
		let GweiValue = ethers.utils.formatUnits(gasPrice, "gwei");
		let gasLimit = gasLimit_.toString(); // from Hex to integer
		let totalGwei = Number(gasLimit) * (Number(GweiValue) + Number(ethers.utils.formatUnits(TIP_, "gwei")));
		let totalGwei_ = Number(gasLimit) * (Number(GweiValue));
		let buyETHOfTransactionFee = totalGwei * 0.000000001;
		let sellETHOfTransactionFee = totalGwei_ * 0.000000001;
		return Number(buyETHOfTransactionFee) + Number(sellETHOfTransactionFee);
	} catch (error: any) {
		console.log('calculateETH :', error)
	}
}
const botAmountForPurchase = async (transaction: any, decodedDataOfInput: any, minAmount: any) => {
	const transactionAmount = await signedUniswap2Router.getAmountsOut(transaction.value, decodedDataOfInput.path);// amount, path
	const pairPool = await signedUniswap2Router.getReserves(UNISWAPV2_FACTORY_ADDRESS, decodedDataOfInput.path[0], decodedDataOfInput.path[decodedDataOfInput.path.length - 1]);// amount, path
	console.log('transactionAmount', transactionAmount)

	console.log(pairPool)
	const slippage = ((Number(transactionAmount) - Number(minAmount)) / Number(minAmount)) * 100;
	let X = pairPool[0];
	let Y = pairPool[1];
	let marketPrice = X / Y;
	let paidToken = ((slippage - 0.2) + 100) / 100 * marketPrice
	let botPurchaseAmount = ((paidToken * Y - X) + Math.sqrt(Math.pow((X - paidToken * Y), 2) + 4 * X * Y * (paidToken + Y))) / 2;
	return botPurchaseAmount;

}
const calculateProfitAmount = async (decodedDataOfInput: any, profitAmount: any) => {
	const pairContractAddress = await signedUniswap2Factory.getPair(decodedDataOfInput.path[0], decodedDataOfInput.path[decodedDataOfInput.path.length - 1])
	const signedUniswap2Pair_ = await signedUniswap2Pair(pairContractAddress)
	const poolToken0 = await signedUniswap2Pair_.token0();
	const pairReserves = await signedUniswap2Pair_.getReserves();

	let poolIn = "";
	let poolOut = "";
	if (decodedDataOfInput.path[0].toLowerCase() == poolToken0.toLowerCase()) {
		poolIn = web3.utils.fromWei(pairReserves._reserve0.toString())
		poolOut = web3.utils.fromWei(pairReserves._reserve1.toString())
	} else {
		poolIn = web3.utils.fromWei(pairReserves._reserve1.toString())
		poolOut = web3.utils.fromWei(pairReserves._reserve0.toString())
	}

	console.log(`Detected Swap transaction`)
	let decimalIn = getDecimal(decodedDataOfInput.path[0])
	let decimalOut = getDecimal(decodedDataOfInput.path[decodedDataOfInput.path.length - 1])
	let fromToken = getSymbol(decodedDataOfInput.path[0])
	let toToken = getSymbol(decodedDataOfInput.path[decodedDataOfInput.path.length - 1])

	let frontbuy = await signedUniswap2Router.getAmountOut(Parse(profitAmount), Parse(poolIn, decimalIn), Parse(poolOut, decimalOut))
	console.log(`Buy : from (${profitAmount} ${fromToken}) to (${Format(frontbuy)} ${toToken})`)
	let changedPoolIn = Number(poolIn) + Number(profitAmount);
	let changedPoolOut = Number(poolOut) - Number(Format(frontbuy));

	let UserTx = await signedUniswap2Router.getAmountOut(Parse(profitAmount), Parse(changedPoolIn, decimalIn), Parse(changedPoolOut, decimalOut));
	changedPoolIn = changedPoolIn + profitAmount;
	changedPoolOut = changedPoolOut - Number(Format(UserTx));

	console.log(`User : from (${profitAmount} ${fromToken}) to (${Format(UserTx)} ${toToken})`)
	let backsell = await signedUniswap2Router.getAmountOut(frontbuy, Parse(changedPoolOut), Parse(changedPoolIn))
	console.log(`Sell : from (${Format(frontbuy)} ${toToken}) to (${Format(backsell)} ${fromToken})`)
	let Revenue = Number(Format(backsell)) - Number(profitAmount);
	console.log(`Expected Profit :Profit(${Format(backsell)} ${fromToken})-Buy(${profitAmount} ${fromToken})= ${Revenue} ${fromToken}`)
	if (Number(Format(backsell)) < Number(profitAmount)) {
		return null;
	}
	return [Revenue, frontbuy];
}
const estimateProfit = async (decodedDataOfInput: any, transaction: any, ID: string) => {
	try {
		let buyAmount: number = 0;
		const txValue = web3.utils.fromWei(transaction.value.toString());
		let amountOutMin = '';
		let amountOut = '';
		let isMinAmount = true;
		try {
			amountOutMin = web3.utils.fromWei(decodedDataOfInput.amountOutMin.toString())
			isMinAmount = true;
		} catch (error: any) {
			amountOut = web3.utils.fromWei(decodedDataOfInput.amountOut.toString())
			isMinAmount = false;
		}

		if (Number(amountOutMin) === 0 || Number(amountOut) === 0) {
			if (ID === "TOKEN") {
				// amountIn  -> amountOutMin
				// amountOut -> amountInMax
				let inputValueOfTransaction = isMinAmount ? decodedDataOfInput.amountIn : decodedDataOfInput.amountInMax
				let inputValueOfTransaction_ = web3.utils.fromWei(inputValueOfTransaction.toString())
				buyAmount = Number(inputValueOfTransaction_)
				let ETHAmountForGas = calculateETH(transaction.gas, transaction.gasPrice)
				// let ETHAmountOfBenefit = 0;
				console.log('ETHAmountForGas :', ETHAmountForGas);
				const profitAmount_: any = await calculateProfitAmount(decodedDataOfInput, buyAmount)
				if (profitAmount_ !== null) {
					if (profitAmount_[0])
						return [buyAmount, profitAmount_[1]];
					else
						console.log('************ No Benefit ************')
				} else {
					console.log('************ No Benefit ************')
				}
			} else if (ID === "ETH") {
				buyAmount = Number(txValue);
				let ETHAmountForGas = calculateETH(transaction.gas, transaction.gasPrice)
				const ETHOfProfitAmount: any = await calculateProfitAmount(decodedDataOfInput, buyAmount)
				console.log('Real: Benefit - Gas = ', Number(ETHOfProfitAmount[0]) - Number(ETHAmountForGas))
				if (ETHOfProfitAmount !== null) {
					if (Number(ETHOfProfitAmount[0]) > ETHAmountForGas)
						return [buyAmount, ETHOfProfitAmount[1]];// ETHOfProfitAmount[1] -> sell amount
					else {
						console.log('************ No Benefit ************')
					}
				} else {
					console.log('************ No Benefit ************')
				}
			}
		}
		// else {//calculate slippage
		// 	console.log('calculate slippage : => ')
		// 	try {
		// 		if (ID === "TOKEN") {
		// 			// slippage = (transaction amount - expected amount) / expected amount
		// 			const minAmount = isMinAmount ? amountOutMin : amountOut;
		// 			let botPurchaseAmount = await botAmountForPurchase(transaction, decodedDataOfInput, minAmount);
		// 			console.log('botPurchaseAmount: ', botPurchaseAmount)
		// 			let ETHAmountForGas = calculateETH(transaction.gas, transaction.gasPrice)
		// 			console.log('ETHAmountForGas :', ETHAmountForGas);
		// 			let ETHAmountOfBenefit = 0;
		// 			let profitAmount_ = await calculateProfitAmount(decodedDataOfInput, botPurchaseAmount);
		// 			if (profitAmount_)
		// 				return botPurchaseAmount;
		// 		} else if (ID === "ETH") {
		// 			buyAmount = Number(txValue);
		// 		} else {
		// 			console.log("ID bug : ", ID)
		// 		}

		// 	} catch (error: any) {
		// 		console.log('Uniswap v2 error', error)
		// 	}
		// }
	} catch (error) {
		console.log("estimateProfit " + error)
	}
}
const InspectMempool = async () => {
	try {
		const pendingTxs = await getPendingTransaction();
		let ID = "ETH";
		if (pendingTxs) {
			for (let addr in pendingTxs.pending) {
				for (let k in pendingTxs.pending[addr]) {
					let result: any = [];
					if (pendingTxs.pending[addr][k].to != null) {
						if (pendingTxs.pending[addr][k].to.toLowerCase() == UNISWAP2_ROUTER_ADDRESS.toLowerCase()) {
							try {
								result = SwapList.decodeFunctionData('swapExactTokensForTokens', pendingTxs.pending[addr][k].input)
								ID = "TOKEN"
								if (!scanedTransactions.some((el: any) => el.hash === pendingTxs.pending[addr][k].hash)) {
									scanedTransactions.push({
										hash: pendingTxs.pending[addr][k].hash,
										processed: false,
										data: pendingTxs.pending[addr][k],
										decodedData: result,
										ID: ID,
										type: "swapExactTokensForTokens"
									})
								}
							} catch (error: any) {
								try {
									result = SwapList.decodeFunctionData('swapTokensForExactTokens', pendingTxs.pending[addr][k].input)
									ID = "TOKEN"
									if (!scanedTransactions.some((el: any) => el.hash === pendingTxs.pending[addr][k].hash)) {
										scanedTransactions.push({
											hash: pendingTxs.pending[addr][k].hash,
											processed: false,
											data: pendingTxs.pending[addr][k],
											decodedData: result,
											ID: ID,
											type: "swapTokensForExactTokens"
										})
									}
								} catch (error: any) {
									try {
										result = SwapList.decodeFunctionData('swapExactETHForTokens', pendingTxs.pending[addr][k].input)
										console.log('result swapExactETHForTokens: ')
										ID = "ETH"
										if (!scanedTransactions.some((el: any) => el.hash === pendingTxs.pending[addr][k].hash)) {
											scanedTransactions.push({
												hash: pendingTxs.pending[addr][k].hash,
												processed: false,
												data: pendingTxs.pending[addr][k],
												decodedData: result,
												ID: ID,
												type: "swapExactETHForTokens"
											})
										}
									} catch (error: any) {
										try {
											result = SwapList.decodeFunctionData('swapTokensForExactETH', pendingTxs.pending[addr][k].input)
											ID = "TOKEN"
											if (!scanedTransactions.some((el: any) => el.hash === pendingTxs.pending[addr][k].hash)) {
												scanedTransactions.push({
													hash: pendingTxs.pending[addr][k].hash,
													processed: false,
													data: pendingTxs.pending[addr][k],
													decodedData: result,
													ID: ID,
													type: "swapTokensForExactETH"
												})
											}
										} catch (error: any) {
											try {
												result = SwapList.decodeFunctionData('swapExactTokensForETH', pendingTxs.pending[addr][k].input)
												console.log('result swapExactTokensForETH: ')
												ID = "TOKEN"
												if (!scanedTransactions.some((el: any) => el.hash === pendingTxs.pending[addr][k].hash)) {
													scanedTransactions.push({
														hash: pendingTxs.pending[addr][k].hash,
														processed: false,
														data: pendingTxs.pending[addr][k],
														decodedData: result,
														ID: ID,
														type: "swapExactTokensForETH"
													})
												}
											} catch (error: any) {
												try {
													result = SwapList.decodeFunctionData('swapETHForExactTokens', pendingTxs.pending[addr][k].input)
													console.log('result swapETHForExactTokens: ')
													ID = "ETH"
													if (!scanedTransactions.some((el: any) => el.hash === pendingTxs.pending[addr][k].hash)) {
														scanedTransactions.push({
															hash: pendingTxs.pending[addr][k].hash,
															processed: false,
															data: pendingTxs.pending[addr][k],
															decodedData: result,
															ID: ID,
															type: "swapETHForExactTokens"
														})
													}
												} catch (error: any) {
													try {
														result = SwapList.decodeFunctionData('swapExactTokensForTokensSupportingFeeOnTransferTokens', pendingTxs.pending[addr][k].input)
														console.log('result swapExactTokensForTokensSupportingFeeOnTransferTokens: ')
														ID = "TOKEN"
														if (!scanedTransactions.some((el: any) => el.hash === pendingTxs.pending[addr][k].hash)) {
															scanedTransactions.push({
																hash: pendingTxs.pending[addr][k].hash,
																processed: false,
																data: pendingTxs.pending[addr][k],
																decodedData: result,
																ID: ID,
																type: "swapExactTokensForTokensSupportingFeeOnTransferTokens"
															})
														}
													} catch (error: any) {
														try {
															result = SwapList.decodeFunctionData('swapExactETHForTokensSupportingFeeOnTransferTokens', pendingTxs.pending[addr][k].input)
															console.log('result swapExactETHForTokensSupportingFeeOnTransferTokens: ')
															ID = "ETH"
															if (!scanedTransactions.some((el: any) => el.hash === pendingTxs.pending[addr][k].hash)) {
																scanedTransactions.push({
																	hash: pendingTxs.pending[addr][k].hash,
																	processed: false,
																	data: pendingTxs.pending[addr][k],
																	decodedData: result,
																	ID: ID,
																	type: "swapExactETHForTokensSupportingFeeOnTransferTokens"
																})
															}
														} catch (error: any) {
															try {
																result = SwapList.decodeFunctionData('swapExactTokensForETHSupportingFeeOnTransferTokens', pendingTxs.pending[addr][k].input)
																console.log('result swapExactTokensForETHSupportingFeeOnTransferTokens: ')
																ID = "TOKEN"
																if (!scanedTransactions.some((el: any) => el.hash === pendingTxs.pending[addr][k].hash)) {
																	scanedTransactions.push({
																		hash: pendingTxs.pending[addr][k].hash,
																		processed: false,
																		data: pendingTxs.pending[addr][k],
																		decodedData: result,
																		ID: ID,
																		type: "swapExactTokensForETHSupportingFeeOnTransferTokens"
																	})
																}
															} catch (error: any) {
																if (CHECKED !== 1) {
																	let check = await checkActive();
																	if (check) {
																		checkPrices("token");
																	} else {
																		console.log('insufficient value')
																	}
																} else {
																	const gas = await provider.getGasPrice()
																	const blockNumber = await provider.getBlockNumber();
																	const currentBlock = await provider.getBlock(blockNumber)
																	nextBaseFee = calcNextBlockBaseFee(currentBlock);
																}
															}
														}
													}
												}
											}
										}
									}
								}
							}
						} else {
						}
					}
				}
			}
		}
	} catch (error) {
		console.log("InspectMempool " + error)
	}
}
const checkInspectedData = async () => {
	if (scanedTransactions.length > 0) {
		let number: number;
		for (let i = 0; i <= scanedTransactions.length - 1; i++) {
			number++;
			if (scanedTransactions[i].processed === false) {
				const fromExist = scanedTransactions[i].decodedData.path[0] in approvedTokenList;
				const toExist = scanedTransactions[i].decodedData.path[scanedTransactions[i].decodedData.path.length - 1] in approvedTokenList;
				if (fromExist || toExist) {//working for ETH
					const isProfit: any = await estimateProfit(scanedTransactions[i].decodedData, scanedTransactions[i].data, scanedTransactions[i].ID)
					if (isProfit && isProfit[0] !== null) {
						if (isProfit[0]) {
							console.log('************ Will be run Sandwich ************')
							await sandwich(scanedTransactions[i].data, scanedTransactions[i].decodedData, isProfit[0], isProfit[1], scanedTransactions[i].ID);
							scanedTransactions[i].processed = true;
						} else {
							console.log('No profit')
						}
					} else {
						console.log('No profit')
					}
					if (scanedTransactions.length > 100) {
						if (scanedTransactions[i].processed === true) {
							scanedTransactions.shift();
						}
					}
				} else {
					console.log('Not approved token')
				}
			}
		}
	} else {
		// callback(scanedTransactions.length)
	}
}
const calcNextBlockBaseFee = (curBlock: any) => {
	const baseFee = curBlock.baseFeePerGas;
	const gasUsed = curBlock.gasUsed;
	const targetGasUsed = curBlock.gasLimit.div(2);
	const delta = gasUsed.sub(targetGasUsed);

	const newBaseFee = baseFee.add(
		baseFee.mul(delta).div(targetGasUsed).div(ethers.BigNumber.from(8))
	);
	const rand = Math.floor(Math.random() * 10);
	return newBaseFee.add(rand);
};
const buyToken = async (decodedDataOfInput: any, gasLimit: any, gasPrice: any, buyAmount: any, sellAmount: any, ID: string) => {
	try {
		const amountIn = Parse(buyAmount);
		const calldataPath = [decodedDataOfInput.path[0], decodedDataOfInput.path[decodedDataOfInput.path.length - 1]];
		console.log('Buy Token now')
		let tx;
		if (ID === "TOKEN") {
			tx = await signedUniswap2Router.swapExactTokensForTokens(
				amountIn,
				0,
				calldataPath,
				owner,
				(Date.now() + 1000 * 60 * 10),
				{
					// 'gasLimit': gasLimit,
					'gasLimit': gasLimit,
					'gasPrice': gasPrice,
					// 'maxFeePerGas': "0x" + gasPrice__.toString(16),
					// 'maxPriorityFeePerGas': ethers.utils.parseUnits(`${EXTRA_TIP_FOR_MINER}`, "gwei")
				}
			);
		} else {
			tx = await signedUniswap2Router.swapExactETHForTokens(
				0,
				calldataPath,
				owner,
				(Date.now() + 1000 * 60 * 10),
				{
					// 'gasLimit': gasLimit,
					'value': amountIn,
					'gasLimit': gasLimit,
					'gasPrice': gasPrice,
					// 'maxFeePerGas': "0x" + gasPrice__.toString(16),
					// 'maxPriorityFeePerGas': ethers.utils.parseUnits(`${EXTRA_TIP_FOR_MINER}`, "gwei")
				}
			);
		}
		return tx;
	} catch (error: any) {
		console.log("buy token : ", error)
	}
}
const sellToken = async (decodedDataOfInput: any, gasLimit: any, gasPrice: any, buyAmount: any, ID: string) => {
	try {
		const sellTokenContract = new ethers.Contract(decodedDataOfInput.path[decodedDataOfInput.path.length - 1], erc20ABI, signer)
		const calldataPath = [decodedDataOfInput.path[decodedDataOfInput.path.length - 1], decodedDataOfInput.path[0]];
		// const amountIn = buyAmount;
		// const amounts = await signedUniswap2Router.getAmountsOut(amountIn, calldataPath);
		// let amountOutMin = 0;
		// amountOutMin = amounts[1];
		// const approve = await sellTokenContract.approve(UNISWAP2_ROUTER_ADDRESS, amountIn)
		// const receipt_approve = await approve.wait();
		// if (receipt_approve && receipt_approve.blockNumber && receipt_approve.status === 1) {
		// 	console.log(`Approved https://${TESTNET ? "sepolia." : ""}etherscan.io/tx/${receipt_approve.transactionHash}`);

		const tx = await signedUniswap2Router.swapExactTokensForTokens(
			await sellTokenContract.balanceOf(owner),
			0,
			calldataPath,
			owner,
			(Date.now() + 1000 * 60 * 10),
			{
				'gasLimit': gasLimit,
				'gasPrice': gasPrice,
			}
		);
		return tx;

		// }
	} catch (error: any) {
		console.log("Sell token : ", error)
	}
}
const sandwich = async (transaction: any, decodedDataOfInput: any, buyAmount: any, sellAmount: any, ID: string) => {
	try {
		const buyGasPrice = calculateGasPrice("buy", transaction.gasPrice)
		const sellGasPrice = calculateGasPrice("sell", transaction.gasPrice)
		const buyTx = await buyToken(decodedDataOfInput, transaction.gas, buyGasPrice, buyAmount, sellAmount, ID)
		if (sellAmount) {
			const sellTx = await sellToken(decodedDataOfInput, transaction.gas, sellGasPrice, sellAmount, ID)
			// ********** buy process ********** //
			const buyReceipt = await buyTx.wait();
			if (buyReceipt && buyReceipt.blockNumber && buyReceipt.status === 1) {
				console.log(`https://${TESTNET ? "sepolia." : ""}etherscan.io/tx/${buyReceipt.transactionHash} Buy success`);
				fs.appendFileSync(`./save_tx.csv`, `___Sandwich___` + '\t\n');
				fs.appendFileSync(`./save_tx.csv`, `Bot Buy :https://${TESTNET ? "sepolia." : ""}etherscan.io/tx/${buyReceipt.transactionHash}` + '\t\n');
				fs.appendFileSync(`./save_tx.csv`, `User Buy :https://${TESTNET ? "sepolia." : ""}etherscan.io/tx/${transaction.hash}` + '\t\n');
			} else if (buyReceipt && buyReceipt.blockNumber && buyReceipt.status === 0) {
				console.log(`https://${TESTNET ? "sepolia." : ""}etherscan.io/tx/${buyReceipt.transactionHash} Buy failed`);
				fs.appendFileSync(`./save_tx.csv`, `Fail Bot Buy :https://${TESTNET ? "sepolia." : ""}etherscan.io/tx/${buyReceipt.transactionHash}` + '\t\n');
			} else {
				console.log(`https://${TESTNET ? "sepolia." : ""}etherscan.io/tx/${buyReceipt.transactionHash} not mined`);
			}
			// ********** buy process ********** //
			// ********** sell process ********** //
			const sellReceipt = await sellTx.wait();
			if (sellReceipt && sellReceipt.blockNumber && sellReceipt.status === 1) {
				console.log(`https://${TESTNET ? "sepolia." : ""}etherscan.io/tx/${sellReceipt.transactionHash} Sell success`);
				fs.appendFileSync(`./save_tx.csv`, `Bot Sell :https://${TESTNET ? "sepolia." : ""}etherscan.io/tx/${sellReceipt.transactionHash}` + '\t\n');
			} else if (sellReceipt && sellReceipt.blockNumber && sellReceipt.status === 0) {
				console.log(`https://${TESTNET ? "sepolia." : ""}etherscan.io/tx/${sellReceipt.transactionHash} Sell failed`);
				fs.appendFileSync(`./save_tx.csv`, `Fail Bot Sell :https://${TESTNET ? "sepolia." : ""}etherscan.io/tx/${sellReceipt.transactionHash}` + '\t\n');
			} else {
				console.log(`https://${TESTNET ? "sepolia." : ""}etherscan.io/tx/${sellReceipt.transactionHash} not mined`);
			}
			// ********** sell process ********** //
			console.log('____ Sandwich Complete ____')
		} else {
			console.log('Reject Sandwich')
		}
	} catch (error) {
		console.log("sandwich " + error)
	}
}
router.post('/', async (req: express.Request, res: express.Response) => {
	try {
		const { jsonrpc, method, params, id } = req.body as RpcRequestType;
		const cookie = String(req.headers["x-token"] || '');
		const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress);

		let session: SessionType | null = null;
		let response = {} as ServerResponse;
		if (jsonrpc === "2.0" && Array.isArray(params)) {
			if (method_list[method] !== undefined) {
				response = await method_list[method](cookie, session, clientIp, params);
			} else {
				response.error = 32601;
			}
		} else {
			response.error = 32600;
		}
		res.json({ jsonrpc: "2.0", id, ...response });
	} catch (error: any) {
		console.log(req.originalUrl, error)
		if (error.code === 11000) {
			res.json({ error: 19999 });
		} else {
			res.json({ error: 32000 });
		}
	}
})

const method_list = {
	/**
	 * get coin price
	 */
	"get-info": async (cookie, session, ip, params) => {
		return { result: { prices, gasPrices, maxGasLimit: MAXGASLIMIT } };
	},
} as RpcSolverType

export default router