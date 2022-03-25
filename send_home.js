/*jslint node: true */
"use strict";

var headlessWallet = require('headless-obyte');
const eventBus = require('ocore/event_bus');
const network = require('ocore/network');

const UNDISTRIBUTED_FUNDS_ADDRESS = 'MZ4GUQC7WUKZKKLGAS3H3FSDKLHI7HFO';

async function send() {
	headlessWallet.setupChatEventHandlers();
	const address = await headlessWallet.issueOrSelectAddressByIndex(0, 1);
	console.error(`=== dist address`, address);
	await network.waitUntilCatchedUp();
	console.error('catched up, will send');
	const { unit } = await headlessWallet.sendAllBytesFromAddress(address, UNDISTRIBUTED_FUNDS_ADDRESS);
	console.error('sent', unit);
}

eventBus.once('headless_wallet_ready', send);
