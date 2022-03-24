/*jslint node: true */
"use strict";

const db = require('ocore/db');
const eventBus = require('ocore/event_bus.js');
const headlessWallet = require('headless-obyte');


async function start() {
	const address = await headlessWallet.issueOrSelectAddressByIndex(0, 1);
	console.error(`=== dist address`, address);

	headlessWallet.setupChatEventHandlers();
	const consolidation = require('headless-obyte/consolidation.js');
	consolidation.scheduleConsolidation(address, headlessWallet.signer, 1, 10 * 60 * 1000);

	reclaim();
}

async function reclaim() {
	console.error(`=== reclaim`);
	const address = await headlessWallet.issueOrSelectAddressByIndex(0, 1);
	const device = require('ocore/device.js');
	const rows = await db.query(
		`SELECT contract_address, SUM(amount) AS total 
		FROM contracts
		CROSS JOIN outputs ON contract_address=address AND is_spent=0 AND asset IS NULL
		WHERE contract_date < '2020-03-24'
		GROUP BY contract_address
		HAVING total > 0`
	);
	console.error(`=== ${rows.length} contracts`);
	if (rows.length === 0)
		return console.error('done');
	const contract_addresses = rows.map(r => r.contract_address);
	let opts = {
		asset: null,
		change_address: address,
		to_address: address,
		send_all: true,
		arrSigningDeviceAddresses: [device.getMyDeviceAddress()],
	};
	while (true) {
		const addresses_chunk = contract_addresses.splice(0, 16);
		if (addresses_chunk.length === 0) {
			console.error(`no more addresses left`);
			break;
		}
		console.error(`will reclaim from`, addresses_chunk);
		opts.paying_addresses = addresses_chunk;
		const { unit } = await headlessWallet.sendMultiPayment(opts);
		console.error(`sent`, unit);
	}
	reclaim();
}


eventBus.once('headless_wallet_ready', start);
process.on('unhandledRejection', up => { throw up; });
