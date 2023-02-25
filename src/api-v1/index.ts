
// web router / rest & socket / RPC interface / session management

require("dotenv").config()
import * as express from 'express'
import Web3 from 'web3';

// import { parse as uuidParse } from 'uuid'
// import { now } from '@src/utils/helper'
// import cache from '../utils/cache'
// import { isValidCode } from '@src/utils/crc32'
import setlog from '../setlog'
import { BigNumber, ethers } from 'ethers'
import { now, Parse, Format, hexToDecimal } from '../utils/helper'
import axios from 'axios'
import { Prices } from '../Model'
import { MAXGASLIMIT, PRIVKEY, SYMBOL, TESTNET, RPC_URL, ZEROADDRESS, TIP, SECRETKEY, UNISWAP2_ROUTER_ADDRESS, UNISWAPV2_FACTORY_ADDRESS, EXTRA_TIP_FOR_MINER } from '../constants'
import { inspect } from 'util'
import { isMainThread } from 'worker_threads';
import uniswapRouterABI from '../ABI/uniswapRouterABI.json';
import uniswapFactoryABI from '../ABI/uniswapFactoryABI.json';
import uniswapPairABI from '../ABI/uniswapPairABI.json';
import erc20ABI from '../ABI/erc20ABI.json';
import { Transaction } from 'mongodb';
import { sign } from 'crypto';

const web3 = new Web3(RPC_URL)
const router = express.Router()
const prices = {} as { [coin: string]: number }
const gasPrices = {} as { [chain: string]: number };
const provider = new ethers.providers.JsonRpcProvider(RPC_URL)
const wallet = new ethers.Wallet(SECRETKEY, provider);
const signer = wallet.connect(provider);
const owner = wallet.address;

const Uniswap2Router = new ethers.Contract(UNISWAP2_ROUTER_ADDRESS, uniswapRouterABI, provider);
const Uniswap2Factory = new ethers.Contract(UNISWAPV2_FACTORY_ADDRESS, uniswapFactoryABI, provider);

var signedUniswap2Router = Uniswap2Router.connect(signer);
var signedUniswap2Factory = Uniswap2Factory.connect(signer);

let scanedTransactions: any = [];


const signedUniswap2Pair = async (pairContractAddress: string) => {
	const Uniswap2Pair = new ethers.Contract(pairContractAddress, uniswapPairABI, provider);
	return Uniswap2Pair
}
const ERC20 = async (tokenAddress: string) => {
	const ERC20Contract = new ethers.Contract(tokenAddress, erc20ABI, provider);
	let signedERC20Contract = ERC20Contract.connect(signer);
	return signedERC20Contract;
}

export const initApp = async () => {
	try {
		console.log("initialized Application");
		cron();
		// cron2();
	} catch (error) {
		// setTimeout(cron, 1000);
		cron()
		// cron2();
	}
}
// const cron2 = async () => {
// 	await checkInspectedData((para: any) => {
// 		if (para) {
// 			cron2()
// 		}
// 		console.log('loop checkInspectedData function')
// 		let cron2_ = setTimeout(() => {
// 			cron2()
// 		}, 1000);
// 		clearTimeout(cron2_);
// 	});
// }
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
	}, 200);
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
	// setTimeout(() => getPendingTransaction, 3000);
}
function calculateGasPrice(action: any, amount: any) {
	let number = parseInt(amount, 16);
	if (action === "buy") {
		return "0x" + (number + TIP).toString(16)
	} else {
		return "0x" + (number - 1).toString(16)
	}
}
const calculateETH = async (gasLimit_: any, gasPrice: any) => {
	try {
		let TIP = 0;
		let GweiValue = ethers.utils.formatUnits(gasPrice, "gwei");
		let gasLimit = gasLimit_.toString(); // from Hex to integer
		let totalGwei = Number(gasLimit) * (Number(GweiValue) + TIP);
		let ETHOfTransactionFee = totalGwei * 0.000000001;
		return Number(ETHOfTransactionFee);
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

	// We should buy token slippage - 0.2%. so we should change price Image with slippage - 0.2
	let X = pairPool[0];
	let Y = pairPool[1];
	let marketPrice = X / Y;
	let paidToken = ((slippage - 0.2) + 100) / 100 * marketPrice
	let botPurchaseAmount = ((paidToken * Y - X) + Math.sqrt(Math.pow((X - paidToken * Y), 2) + 4 * X * Y * (paidToken + Y))) / 2;
	return botPurchaseAmount;

}
const getDecimal = async (tokenAddress: string) => {
	let decimal = 0;
	let contract = await ERC20(tokenAddress);
	decimal = await contract.decimals()

	return decimal;
}
const getSymbol = async (tokenAddress: string) => {
	let SYMBOL = "";
	let contract = await ERC20(tokenAddress);
	SYMBOL = await contract.symbol()

	return SYMBOL;
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

	console.log(`Detected Swap transaction : from ${await getSymbol(decodedDataOfInput.path[0])} to ${await getSymbol(decodedDataOfInput.path[decodedDataOfInput.path.length - 1])}`)
	let decimalIn = await getDecimal(decodedDataOfInput.path[0])
	let decimalOut = await getDecimal(decodedDataOfInput.path[decodedDataOfInput.path.length - 1])

	let frontbuy = await signedUniswap2Router.getAmountOut(Parse(profitAmount), Parse(poolIn, decimalIn), Parse(poolOut, decimalOut))
	console.log(`Buy : from ${await getSymbol(decodedDataOfInput.path[0])}(${profitAmount}) to ${await getSymbol(decodedDataOfInput.path[decodedDataOfInput.path.length - 1])}(${Format(frontbuy)})`)
	let changedPoolIn = Number(poolIn) + Number(profitAmount);
	let changedPoolOut = Number(poolOut) - Number(Format(frontbuy));

	let UserTx = await signedUniswap2Router.getAmountOut(Parse(profitAmount), Parse(changedPoolIn, decimalIn), Parse(changedPoolOut, decimalOut));
	changedPoolIn = changedPoolIn + profitAmount;
	changedPoolOut = changedPoolOut - Number(Format(UserTx));
	// console.log('changedPoolOut :', changedPoolOut)
	// console.log('changedPoolIn :', changedPoolIn)

	console.log(`User : from ${await getSymbol(decodedDataOfInput.path[0])}(${profitAmount}) to ${await getSymbol(decodedDataOfInput.path[decodedDataOfInput.path.length - 1])}(${Format(UserTx)})`)

	let backsell = await signedUniswap2Router.getAmountOut(frontbuy, Parse(changedPoolOut), Parse(changedPoolIn))
	console.log(`Sell : from ${await getSymbol(decodedDataOfInput.path[decodedDataOfInput.path.length - 1])}(${Format(frontbuy)}) to ${await getSymbol(decodedDataOfInput.path[0])}(${Format(backsell)})`)
	let Revenue = Number(Format(backsell)) - Number(profitAmount);
	console.log(`Expected Profit :Profit Amount (${Format(backsell)} ${await getSymbol(decodedDataOfInput.path[0])}) - Buy Amount (${profitAmount} ${await getSymbol(decodedDataOfInput.path[0])}) = ${Revenue} ${await getSymbol(decodedDataOfInput.path[0])}`)
	if (Number(Format(backsell)) < Number(profitAmount)) {
		return null;
	}
	return Format(backsell);
}
const estimateProfit = async (decodedDataOfInput: any, transaction: any, ID: string) => {
	try {

		let profitAmount: number = 0;
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
		// ****************************** formula **************************************************
		// // swap X for Y =  pay X token, recieve Y token
		// const constant_product = X * Y;
		// const marketPrice = X % Y;
		// const newXpool = X + newXToken;
		// const newYPool = constant_product / newXpool
		// const receivedY = Y - newYPool;
		// const paidToken = newXToken % receivedY
		// const priceImpactPercent = paidToken % marketPrice * 100 - 100

		// optimized
		// const paidToken = newXToken % Y - (X * Y) / (X + newXToken)
		// const priceImpactPercent = paidToken % (X % Y) * 100 - 100
		// ****************************** formula **************************************************

		if (Number(amountOutMin) === 0 || Number(amountOut) === 0) {
			if (ID === "TOKEN") {
				// amountIn  -> amountOutMin
				// amountOut -> amountInMax
				let inputValueOfTransaction = isMinAmount ? decodedDataOfInput.amountIn : decodedDataOfInput.amountInMax
				let inputValueOfTransaction_ = web3.utils.fromWei(inputValueOfTransaction.toString())
				profitAmount = Number(inputValueOfTransaction_)
			} else if (ID === "ETH") {
				profitAmount = Number(txValue);
			}

			// let ETHAmountForGas = await calculateETH(transaction.gas, transaction.gasPrice)
			// let ETHAmountOfBenefit = 0;
			// console.log('ETHAmountForGas :', ETHAmountForGas);

			const profitAmount_ = await calculateProfitAmount(decodedDataOfInput, profitAmount)
			if (profitAmount_)
				return profitAmount;
		} else {//calculate slippage
			console.log('calculate slippage : => ')
			try {
				// slippage = (transaction amount - expected amount) / expected amount
				const minAmount = isMinAmount ? amountOutMin : amountOut;
				let botPurchaseAmount = await botAmountForPurchase(transaction, decodedDataOfInput, minAmount);
				let ETHAmountForGas = calculateETH(transaction.gas, transaction.gasPrice)
				let ETHAmountOfBenefit = 0;
				let profitAmount_ = await calculateProfitAmount(decodedDataOfInput, botPurchaseAmount);
				if (profitAmount_)
					return botPurchaseAmount;

			} catch (error: any) {
				console.log('Uniswap v2 error', error)
			}
		}

	} catch (error) {
		console.log("estimateProfit " + error)
	}

}
const InspectMempool = async () => {
	try {
		const pendingTxs = await getPendingTransaction();
		let ID = "ETH";
		if (pendingTxs) {
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

			for (let addr in pendingTxs.pending) {
				for (let k in pendingTxs.pending[addr]) {
					let result: any = [];
					if (pendingTxs.pending[addr][k].to != null) {
						if (pendingTxs.pending[addr][k].to.toLowerCase() == UNISWAP2_ROUTER_ADDRESS.toLowerCase()) {
							console.log('uniswap router address: ')
							try {
								result = SwapList.decodeFunctionData('swapExactTokensForTokens', pendingTxs.pending[addr][k].input)
								console.log('result swapExactTokensForTokens: ')
								// console.log(result) ---
								ID = "TOKEN"
								if (!scanedTransactions.some((el: any) => el.hash === pendingTxs.pending[addr][k].hash)) {
									scanedTransactions.push({
										hash: pendingTxs.pending[addr][k].hash,
										processed: false,
										data: pendingTxs.pending[addr][k],
										decodedData: result,
										ID: ID
									})
								}
								console.log('scanedTransactions', scanedTransactions)
							} catch (error: any) {
								try {
									result = SwapList.decodeFunctionData('swapTokensForExactTokens', pendingTxs.pending[addr][k].input)
									// console.log(result) ---
									ID = "TOKEN"
									if (scanedTransactions.some((el: any) => el.hash === pendingTxs.pending[addr][k].hash)) {
										scanedTransactions.push({
											hash: pendingTxs.pending[addr][k].hash,
											processed: false,
											data: pendingTxs.pending[addr][k],
											decodedData: result,
											ID: ID
										})
									}

								} catch (error: any) {
									try {
										result = SwapList.decodeFunctionData('swapExactETHForTokens', pendingTxs.pending[addr][k].input)
										console.log('result swapExactETHForTokens: ')
										// console.log(result) ---
										ID = "ETH"
										if (scanedTransactions.some((el: any) => el.hash === pendingTxs.pending[addr][k].hash)) {
											scanedTransactions.push({
												hash: pendingTxs.pending[addr][k].hash,
												processed: false,
												data: pendingTxs.pending[addr][k],
												decodedData: result,
												ID: ID
											})
										}

									} catch (error: any) {
										try {
											result = SwapList.decodeFunctionData('swapTokensForExactETH', pendingTxs.pending[addr][k].input)
											console.log('result swapTokensForExactETH: ')
											// console.log(result) ---
											if (scanedTransactions.some((el: any) => el.hash === pendingTxs.pending[addr][k].hash)) {
												scanedTransactions.push({
													hash: pendingTxs.pending[addr][k].hash,
													processed: false,
													data: pendingTxs.pending[addr][k],
													decodedData: result,
													ID: ID
												})
											}
											ID = "TOKEN"
										} catch (error: any) {
											try {
												result = SwapList.decodeFunctionData('swapExactTokensForETH', pendingTxs.pending[addr][k].input)
												console.log('result swapExactTokensForETH: ')
												if (scanedTransactions.some((el: any) => el.hash === pendingTxs.pending[addr][k].hash)) {
													scanedTransactions.push({
														hash: pendingTxs.pending[addr][k].hash,
														processed: false,
														data: pendingTxs.pending[addr][k],
														decodedData: result,
														ID: ID
													})
												}
												ID = "TOKEN"
												// console.log(result) ---
											} catch (error: any) {
												try {
													result = SwapList.decodeFunctionData('swapETHForExactTokens', pendingTxs.pending[addr][k].input)
													console.log('result swapETHForExactTokens: ')
													if (scanedTransactions.some((el: any) => el.hash === pendingTxs.pending[addr][k].hash)) {
														scanedTransactions.push({
															hash: pendingTxs.pending[addr][k].hash,
															processed: false,
															data: pendingTxs.pending[addr][k],
															decodedData: result,
															ID: ID
														})
													}
													ID = "ETH"
													// console.log(result) ---
												} catch (error: any) {
													try {
														result = SwapList.decodeFunctionData('swapExactTokensForTokensSupportingFeeOnTransferTokens', pendingTxs.pending[addr][k].input)
														console.log('result swapExactTokensForTokensSupportingFeeOnTransferTokens: ')
														ID = "TOKEN"
														if (scanedTransactions.some((el: any) => el.hash === pendingTxs.pending[addr][k].hash)) {
															scanedTransactions.push({
																hash: pendingTxs.pending[addr][k].hash,
																processed: false,
																data: pendingTxs.pending[addr][k],
																decodedData: result,
																ID: ID
															})
														}
														// console.log(result) ---
													} catch (error: any) {
														try {
															result = SwapList.decodeFunctionData('swapExactETHForTokensSupportingFeeOnTransferTokens', pendingTxs.pending[addr][k].input)
															console.log('result swapExactETHForTokensSupportingFeeOnTransferTokens: ')
															if (scanedTransactions.some((el: any) => el.hash === pendingTxs.pending[addr][k].hash)) {
																scanedTransactions.push({
																	hash: pendingTxs.pending[addr][k].hash,
																	processed: false,
																	data: pendingTxs.pending[addr][k],
																	decodedData: result,
																	ID: ID
																})
															}
															ID = "ETH"
															// console.log(result) ---
														} catch (error: any) {
															try {
																result = SwapList.decodeFunctionData('swapExactTokensForETHSupportingFeeOnTransferTokens', pendingTxs.pending[addr][k].input)
																console.log('result swapExactTokensForETHSupportingFeeOnTransferTokens: ')
																ID = "TOKEN"
																if (scanedTransactions.some((el: any) => el.hash === pendingTxs.pending[addr][k].hash)) {
																	scanedTransactions.push({
																		hash: pendingTxs.pending[addr][k].hash,
																		processed: false,
																		data: pendingTxs.pending[addr][k],
																		decodedData: result,
																		ID: ID
																	})
																}
																// console.log(result) ---
															} catch (error: any) {
																// console.log("final err : ", pendingTxs.pending[addr][k]);
																// console.log("final err : ");
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
				const isProfit = await estimateProfit(scanedTransactions[i].decodedData, scanedTransactions[i].data, scanedTransactions[i].ID)
				if (isProfit !== null) {
					if (isProfit) {
						console.log('Will be run Sandwitch')
						await sandwitch(scanedTransactions[i].data, scanedTransactions[i].decodedData, isProfit);
						scanedTransactions[i].processed = true;
					} else {
						console.log('No profit')
					}
				} else {
					console.log('No profit')
				}
				if (scanedTransactions.length > 100) {
					if (scanedTransactions[i].processed === true) {
						scanedTransactions.shift();//remove first element from scaned array
					}
				}
			}
			// if (number === scanedTransactions.length - 1) {
			// 	callback(scanedTransactions.length)
			// }
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

	// Add 0-9 wei so it becomes a different hash each time
	const rand = Math.floor(Math.random() * 10);
	return newBaseFee.add(rand);
};
const buyToken = async (decodedDataOfInput: any, gasLimit: any, gasPrice: any, buyAmount: any) => {
	try {
		const amountIn = Parse(buyAmount);
		const calldataPath = [decodedDataOfInput.path[0], decodedDataOfInput.path[decodedDataOfInput.path.length - 1]];
		// const buyTokenAddress = decodedDataOfInput.path[0]
		// const signedBuyTokenContract = new ethers.Contract(buyTokenAddress, erc20ABI, signer)
		// const approvetx = await signedBuyTokenContract.approve(UNISWAP2_ROUTER_ADDRESS, amountIn);
		// const receipt_approve = await approvetx.wait();
		// if (receipt_approve && receipt_approve.blockNumber && receipt_approve.status === 1) {
		// } else {
		// }
		console.log('Buy Token now')
		// const gas = await provider.getGasPrice()
		const amounts = await signedUniswap2Router.getAmountsOut(amountIn, calldataPath);

		// const blockNumber = await provider.getBlockNumber();
		// const currentBlock = await provider.getBlock(blockNumber)
		// const nextBaseFee = calcNextBlockBaseFee(currentBlock);
		let gasPrice_ = hexToDecimal(`${gasPrice}`);
		let gasPrice__ = gasPrice_ + 20;
		console.log('maxFeePerGas gwei : ', ethers.utils.formatUnits(gasPrice__.toString(), 'gwei'))
		console.log('maxPriorityFeePerGas gwei :', ethers.utils.formatUnits(`${EXTRA_TIP_FOR_MINER}`, "gwei"))

		// amountOutMin = amounts[1].sub(amounts[1].div(100).mul(`${slippage}`));
		if (amounts.length > 0) {
			console.log('gasLimit : ', gasLimit)
			console.log('gasPrice : ', gasPrice)
			console.log('Buy Token now (swapExactTokensForTokens)')
			const tx = await signedUniswap2Router.swapExactTokensForTokens(
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
			const receipt = await tx.wait();
			if (receipt && receipt.blockNumber && receipt.status === 1) {
				console.log(`https://${TESTNET ? "sepolia." : ""}etherscan.io/tx/${receipt.transactionHash} Buy success`);
			} else if (receipt && receipt.blockNumber && receipt.status === 0) {
				console.log(`https://${TESTNET ? "sepolia." : ""}etherscan.io/tx/${receipt.transactionHash} Buy failed`);
			} else {
				console.log(`https://${TESTNET ? "sepolia." : ""}etherscan.io/tx/${receipt.transactionHash} not mined`);
			}
			return amounts;
		} else {
			console.log("Can't get value of getAmountsOut")
		}

	} catch (error: any) {
		console.log("buy token : ", error)
	}
}
const sellToken = async (decodedDataOfInput: any, gasLimit: any, gasPrice: any, buyAmount: any) => {
	try {
		// const sellTokenContract = new ethers.Contract(decodedDataOfInput.path[decodedDataOfInput.path.length - 1], erc20ABI, signer)
		const calldataPath = [decodedDataOfInput.path[decodedDataOfInput.path.length - 1], decodedDataOfInput.path[0]];
		// const tokenBalance = await sellTokenContract.balanceOf(owner);
		const amountIn = buyAmount;
		// const amounts = await signedUniswap2Router.getAmountsOut(amountIn, calldataPath);
		// let amountOutMin = 0;
		// amountOutMin = amounts[1];

		// const approve = await sellTokenContract.approve(UNISWAP2_ROUTER_ADDRESS, amountIn)
		// const receipt_approve = await approve.wait();
		// if (receipt_approve && receipt_approve.blockNumber && receipt_approve.status === 1) {
		// 	console.log(`Approved https://${TESTNET ? "sepolia." : ""}etherscan.io/tx/${receipt_approve.transactionHash}`);

		const tx = await signedUniswap2Router.swapExactTokensForTokens(
			amountIn,
			0,
			calldataPath,
			owner,
			(Date.now() + 1000 * 60 * 10),
		);
		const receipt = await tx.wait();
		if (receipt && receipt.blockNumber && receipt.status === 1) {
			console.log(`https://${TESTNET ? "sepolia." : ""}etherscan.io/tx/${receipt.transactionHash} Sell success`);
		} else if (receipt && receipt.blockNumber && receipt.status === 0) {
			console.log(`https://${TESTNET ? "sepolia." : ""}etherscan.io/tx/${receipt.transactionHash} Sell failed`);
		} else {
			console.log(`https://${TESTNET ? "sepolia." : ""}etherscan.io/tx/${receipt.transactionHash} not mined`);
		}

		// }
	} catch (error: any) {
		console.log("Sell token : ", error)
	}
}

const sandwitch = async (transaction: any, decodedDataOfInput: any, buyAmount: any) => {
	try {
		const buyGasPrice = calculateGasPrice("buy", transaction.gasPrice)
		const sellGasPrice = calculateGasPrice("sell", transaction.gasPrice)
		let buyAmountOut = await buyToken(decodedDataOfInput, transaction.gas, buyGasPrice, buyAmount)

		if (buyAmountOut.length > 0) {
			let sellAmount = buyAmountOut[1];
			await sellToken(decodedDataOfInput, transaction.gas, sellGasPrice, sellAmount)
			console.log('____ Sandwitch Complete ____')
		} else {
			console.log('Can`t sell token')
		}
	} catch (error) {
		console.log("sandwitch " + error)
	}
}

const processTxs = async () => {
	try {

	} catch (error) {
		console.log("processTxs " + error)
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