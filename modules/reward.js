/*jslint node: true */
'use strict';
const conf = require('byteballcore/conf');
const db = require('byteballcore/db');
const notifications = require('./notifications');
const steemAttestation = require('./steem_attestation');

exports.distributionAddress = null;

function sendReward(outputs, device_address, onDone){
	let headlessWallet = require('headless-byteball');
	headlessWallet.sendMultiPayment({
		asset: null,
		base_outputs: outputs,
		paying_addresses: [exports.distributionAddress],
		change_address: exports.distributionAddress,
		recipient_device_address: device_address
	}, (err, unit) => {
		if (err){
			console.log("failed to send reward: "+err);
			let balances = require('byteballcore/balances');
			balances.readOutputsBalance(exports.distributionAddress, (balance) => {
				console.error(balance);
				notifications.notifyAdmin('failed to send reward', err + ", balance: " + JSON.stringify(balance));
			});
		}
		else
			console.log("sent reward, unit "+unit);
		onDone(err, unit);
	});
}


function sendAndWriteReward(reward_type, transaction_id){
	const mutex = require('byteballcore/mutex.js');
	const table = (reward_type === 'referral') ? 'referral_reward_units' : 'reward_units';
	mutex.lock(['tx-'+transaction_id], unlock => {
		db.query(
			`SELECT receiving_addresses.device_address, reward_date, reward, `+table+`.user_address, contract_reward, contract_address 
			FROM `+table+` 
			CROSS JOIN transactions USING(transaction_id)
			CROSS JOIN receiving_addresses USING(receiving_address)
			LEFT JOIN contracts ON `+table+`.user_address=contracts.user_address 
			WHERE transaction_id=?`, 
			[transaction_id], 
			rows => {
				if (rows.length === 0)
					throw Error("no record in "+table+" for tx "+transaction_id);
				let row = rows[0];
				if (row.reward_date) // already sent
					return unlock();
				if (row.contract_reward && !row.contract_address)
					throw Error("no contract address for reward "+reward_type+" "+transaction_id);
				let outputs = [];
				if (row.reward)
					outputs.push({address: row.user_address, amount: row.reward});
				if (row.contract_reward)
					outputs.push({address: row.contract_address, amount: row.contract_reward});
				if (outputs.length === 0)
					throw Error("no rewards in tx "+reward_type+" "+transaction_id);
				sendReward(outputs, row.device_address, (err, unit) => {
					if (err)
						return unlock();
					db.query(
						"UPDATE "+table+" SET reward_unit=?, reward_date="+db.getNow()+" WHERE transaction_id=?", 
						[unit, transaction_id], 
						() => {
							let device = require('byteballcore/device.js');
							device.sendMessageToDevice(row.device_address, 'text', "Sent the "+reward_type+" reward");
							unlock();
						}
					);
				});
			}
		);
	});
}

function retrySendingRewardsOfType(reward_type) {
	const tableName = (reward_type === 'referral') ? 'referral_reward_units' : 'reward_units';
	db.query(
		`SELECT transaction_id FROM ${tableName} WHERE reward_unit IS NULL LIMIT 5`,
		(rows) => {
			rows.forEach((row) => {
				sendAndWriteReward(reward_type, row.transaction_id);
			});
		}
	);
}

function retrySendingRewards() {
	retrySendingRewardsOfType('attestation');
	retrySendingRewardsOfType('referral');
}

function findReferrer(payment_unit, user_address, device_address, handleReferrer) {
	let assocMcisByAddress = {};
	let depth = 0;
	if (!steemAttestation.steemAttestorAddress)
		throw Error('no steemAttestorAddress in reward');

	function goBack(arrUnits) {
		depth++;
		// console.error('goBack', depth, arrUnits);
		if (!arrUnits || !arrUnits.length) return tryToFindLinkReferrer();
		db.query(
			`SELECT 
				address, src_unit, main_chain_index 
			FROM inputs 
			JOIN units ON src_unit=units.unit
			WHERE inputs.unit IN(?) 
				AND type='transfer' 
				AND asset IS NULL`,
			[arrUnits],
			(rows) => {
				rows.forEach((row) => {
					if (row.address === user_address) // no self-refferrers
						return;
					if (!assocMcisByAddress[row.address] || assocMcisByAddress[row.address] < row.main_chain_index)
						assocMcisByAddress[row.address] = row.main_chain_index;
				});
				let arrSrcUnits = rows.map((row) => row.src_unit);
				(depth < conf.MAX_REFERRAL_DEPTH) ? goBack(arrSrcUnits) : selectReferrer();
			}
		);
	}

	function selectReferrer() {
		let arrAddresses = Object.keys(assocMcisByAddress);
		console.log('findReferrer '+payment_unit+': ancestor addresses: '+arrAddresses.join(', '));
		if (arrAddresses.length === 0)
			return tryToFindLinkReferrer();
		db.query(
			`SELECT 
				address, user_address, device_address, username, payload, app
			FROM attestations
			JOIN messages USING(unit, message_index)
			JOIN attestation_units ON unit=attestation_unit
			JOIN transactions USING(transaction_id)
			JOIN receiving_addresses USING(receiving_address)
			LEFT JOIN accepted_payments USING(transaction_id)
			WHERE address IN(${arrAddresses.map(db.escape).join(', ')}) 
				AND +attestor_address=? 
				AND (accepted_payments.payment_unit IS NULL OR accepted_payments.payment_unit!=?)`,
			[steemAttestation.steemAttestorAddress, payment_unit],
			(rows) => {
				if (rows.length === 0){
					console.log("findReferrer "+payment_unit+": no referrers");
					return tryToFindLinkReferrer();
				}

				let max_mci = 0;
				let best_user_id, best_row;
				rows.forEach((row) => {
					if (row.app !== 'attestation') {
						throw Error(`unexpected app ${row.app} for payment ${payment_unit}`);
					}
					if (row.address !== row.user_address) {
						throw Error(`different addresses: address ${row.address}, user_address ${row.user_address} for payment ${payment_unit}`);
					}

					let payload = JSON.parse(row.payload);
					if (payload.address !== row.address) {
						throw Error(`different addresses: address ${row.address}, payload ${row.payload} for payment ${payment_unit}`);
					}

					let user_id = payload.profile.user_id;
					if (!user_id) {
						throw Error("no user_id for payment " + payment_unit);
					}

					let mci = assocMcisByAddress[row.address];
					if (mci > max_mci) {
						max_mci = mci;
						best_row = row;
						best_user_id = user_id;
					}
				});
				if (!best_row || !best_user_id) {
					throw Error("no best for payment " + payment_unit);
				}

				console.log("findReferrer "+payment_unit+": found payment referrer for user "+user_address+": "+best_row.user_address);
				if (best_row.device_address === device_address){ // no self-referring
					console.log("findReferrer "+payment_unit+": self-referring");
					return tryToFindLinkReferrer();
				}
				handleReferrer(best_user_id, best_row.user_address, best_row.device_address, best_row.username);
			}
		);
	}
	
	function tryToFindLinkReferrer(){
		console.log("tryToFindLinkReferrer "+user_address);
		db.query(
			`SELECT referring_user_address, payload, app, type,
			receiving_addresses.device_address, receiving_addresses.user_address, receiving_addresses.username
			FROM link_referrals 
			CROSS JOIN attestations ON referring_user_address=attestations.address AND attestor_address=?
			CROSS JOIN messages USING(unit, message_index)
			CROSS JOIN attestation_units ON unit=attestation_unit
			CROSS JOIN transactions USING(transaction_id)
			CROSS JOIN receiving_addresses USING(receiving_address)
			WHERE link_referrals.device_address=? 
				AND receiving_addresses.device_address != link_referrals.device_address
				AND referring_user_address != ?
			ORDER BY link_referrals.creation_date DESC LIMIT 1`, 
			[steemAttestation.steemAttestorAddress, device_address, user_address],
			rows => {
				if (rows.length === 0)
					return handleReferrer();
				let row = rows[0];
				console.log("found "+row.type+" referrer for device "+device_address+": "+row.referring_user_address);
				if (row.app !== 'attestation')
					throw Error(`unexpected app ${row.app} for attestation of user who referred ${device_address}`);
				if (row.referring_user_address !== row.user_address)
					throw Error(`different addresses: referring_user_address ${row.referring_user_address}, user_address ${row.user_address} for device ${device_address}`);
				let payload = JSON.parse(row.payload);
				if (payload.address !== row.referring_user_address)
					throw Error(`different addresses: referring_user_address ${row.referring_user_address}, payload ${row.payload} for device ${device_address}`);
				let referring_user_id = payload.profile.user_id;
				if (!referring_user_id)
					throw Error("no user_id for device " + device_address + " payload " + row.payload);
				handleReferrer(referring_user_id, row.referring_user_address, row.device_address, row.username);
			}
		);
	}
	
	console.log("findReferrer "+payment_unit+", "+user_address+", "+device_address);
	payment_unit ? goBack([payment_unit]) : tryToFindLinkReferrer();
}


exports.sendAndWriteReward = sendAndWriteReward;
exports.retrySendingRewards = retrySendingRewards;
exports.findReferrer = findReferrer;
