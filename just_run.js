/*jslint node: true */
"use strict";

var headlessWallet = require('headless-obyte');
const eventBus = require('ocore/event_bus');


async function consolidate() {
	const address = await headlessWallet.issueOrSelectAddressByIndex(0, 1);

	const consolidation = require('headless-obyte/consolidation.js');
	consolidation.consolidate(address, headlessWallet.signer, 1);		
}

eventBus.once('headless_wallet_ready', () => setTimeout(consolidate, 60 * 1000));
